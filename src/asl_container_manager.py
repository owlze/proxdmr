"""
AllStarLink v3 (ASL3) Container Orchestration Manager for ProxDMR
Manages isolated Docker containers for each user's AllStarLink node.
Communicates directly with the Docker Engine daemon via Unix Domain Socket (/var/run/docker.sock).
"""

import os
import sys
import time
import json
import socket
import logging
import shutil
import http.client
import re
from typing import Dict, Any, Optional, List, Tuple, Callable

logger = logging.getLogger("proxdmr.asl_containers")

# Константы путей
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
INSTANCES_DIR = os.path.join(DATA_DIR, "asl_instances")
HOST_DATA_DIR = os.getenv("HOST_DATA_DIR", "/opt/proxdmr/data")
DOCKER_SOCKET_PATH = os.getenv("DOCKER_SOCKET_PATH", "/var/run/docker.sock")
ASL_IMAGE = os.getenv("ASL_IMAGE", "proxdmr-asl3:latest")

# Порты
IAX_PORT_RANGE = (4569, 4700)
AMI_PORT_RANGE = (50380, 50500)

DEFAULT_DOCKERFILE_ASL3 = '''FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates procps net-tools iproute2 sox libncurses6 \
    && curl -fsSL https://repo.allstarlink.org/public/asl-apt-repos.deb12_all.deb -o /tmp/asl.deb \
    && dpkg -i /tmp/asl.deb \
    && rm -f /tmp/asl.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    asl3-asterisk asl3-asterisk-modules asl3-asterisk-config asl3-update-nodelist \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
RUN mkdir -p /etc/asterisk /var/log/asterisk /var/spool/asterisk /var/lib/asterisk /var/run/asterisk \
    && chown -R asterisk:asterisk /etc/asterisk /var/log/asterisk /var/spool/asterisk /var/lib/asterisk /var/run/asterisk
EXPOSE 4569/udp 5038/tcp
COPY docker-entrypoint-asl3.sh /usr/local/bin/docker-entrypoint-asl3.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-asl3.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint-asl3.sh"]
CMD ["asterisk", "-f", "-U", "asterisk", "-G", "asterisk"]
'''

DEFAULT_ENTRYPOINT_ASL3 = '''#!/bin/bash
set -e
mkdir -p /var/log/asterisk /var/spool/asterisk /var/lib/asterisk /var/run/asterisk /etc/asterisk
chown -R asterisk:asterisk /var/log/asterisk /var/spool/asterisk /var/lib/asterisk /var/run/asterisk 2>/dev/null || true
chmod -R a+rX /etc/asterisk 2>/dev/null || true
exec "$@"
'''


class DockerUnixConnection(http.client.HTTPConnection):
    """HTTPConnection поверх Unix Domain Socket для Docker Engine REST API"""
    def __init__(self, socket_path: str = DOCKER_SOCKET_PATH, timeout: float = 10.0):
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


class DockerClient:
    """Легковесный клиент Docker REST API без внешних тяжелых зависимостей"""
    def __init__(self, socket_path: str = DOCKER_SOCKET_PATH):
        self.socket_path = socket_path
        self._is_available: Optional[bool] = None

    def is_available(self) -> bool:
        if self._is_available is not None:
            return self._is_available
        if not os.path.exists(self.socket_path):
            self._is_available = False
            return False
        try:
            conn = DockerUnixConnection(self.socket_path, timeout=2.0)
            conn.request("GET", "/_ping")
            res = conn.getresponse()
            self._is_available = (res.status == 200)
            conn.close()
        except Exception as e:
            logger.warning(f"Docker socket unavailable at {self.socket_path}: {e}")
            self._is_available = False
        return self._is_available

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> tuple[int, Any]:
        if not self.is_available():
            raise RuntimeError(f"Docker socket not accessible at {self.socket_path}")
        
        conn = DockerUnixConnection(self.socket_path, timeout=15.0)
        headers = {"Host": "localhost"}
        payload = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(body)
            
        conn.request(method, path, body=payload, headers=headers)
        res = conn.getresponse()
        raw = res.read().decode("utf-8", errors="replace")
        conn.close()
        
        try:
            parsed = json.loads(raw) if raw else None
        except Exception:
            parsed = raw
            
        return res.status, parsed

    def list_containers(self, all_containers: bool = True) -> List[dict]:
        status, data = self._request("GET", f"/containers/json?all={1 if all_containers else 0}")
        if status == 200 and isinstance(data, list):
            return data
        return []

    def inspect_container(self, name_or_id: str) -> Optional[dict]:
        status, data = self._request("GET", f"/containers/{name_or_id}/json")
        if status == 200 and isinstance(data, dict):
            return data
        return None

    def resolve_host_environment(self) -> tuple[str, str]:
        """
        Dynamically resolves (host_data_dir, docker_network) by inspecting the current
        proxdmr container via Docker Socket. Works for /opt/proxdmr, /opt/proxdmr-demo,
        or any custom GitHub installation directory.
        """
        host_data = os.getenv("HOST_DATA_DIR", "").strip()
        net_name = os.getenv("DOCKER_NETWORK", "").strip()
        if host_data and net_name:
            return host_data, net_name

        try:
            self_id = socket.gethostname()
            info = self.inspect_container(self_id)
            if not info:
                for c in self.list_containers(all_containers=False):
                    names = [n.lstrip("/") for n in c.get("Names", [])]
                    if any(n.startswith("proxdmr") and "watchdog" not in n for n in names):
                        info = self.inspect_container(c["Id"])
                        break
            if info:
                if not host_data:
                    for m in info.get("Mounts", []):
                        dest = m.get("Destination", "").rstrip("/")
                        if dest.endswith("/src/data") or dest == "/app/src/data":
                            host_data = m.get("Source", "")
                            break
                if not net_name:
                    nets = list((info.get("NetworkSettings", {}).get("Networks") or {}).keys())
                    if nets:
                        net_name = nets[0]
        except Exception as e:
            logger.debug(f"Could not auto-resolve host environment from Docker socket: {e}")

        return (host_data or "/opt/proxdmr/data"), (net_name or "proxdmr_default")

    def image_exists(self, image_name: str = ASL_IMAGE) -> bool:
        if not self.is_available():
            return False
        try:
            status, _ = self._request("GET", f"/images/{image_name}/json")
            return status == 200
        except Exception:
            return False

    def ensure_asl_image(self, image_name: str = ASL_IMAGE) -> bool:
        if not self.is_available():
            return False
        if self.image_exists(image_name):
            return True

        logger.info(f"Image {image_name} not found on host. Building on the fly via Docker socket...")
        import io
        import tarfile

        app_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        df_path = os.path.join(app_root, "Dockerfile.asl3")
        entry_path = os.path.join(app_root, "docker-entrypoint-asl3.sh")

        if os.path.exists(df_path):
            with open(df_path, "r", encoding="utf-8") as f:
                df_content = f.read()
        else:
            df_content = DEFAULT_DOCKERFILE_ASL3

        if os.path.exists(entry_path):
            with open(entry_path, "r", encoding="utf-8") as f:
                entry_content = f.read()
        else:
            entry_content = DEFAULT_ENTRYPOINT_ASL3

        df_bytes = df_content.replace("\r\n", "\n").encode("utf-8")
        entry_bytes = entry_content.replace("\r\n", "\n").encode("utf-8")

        tar_stream = io.BytesIO()
        with tarfile.open(fileobj=tar_stream, mode="w") as tar:
            ti_df = tarfile.TarInfo(name="Dockerfile")
            ti_df.size = len(df_bytes)
            ti_df.mode = 0o644
            tar.addfile(ti_df, io.BytesIO(df_bytes))

            ti_entry = tarfile.TarInfo(name="docker-entrypoint-asl3.sh")
            ti_entry.size = len(entry_bytes)
            ti_entry.mode = 0o755
            tar.addfile(ti_entry, io.BytesIO(entry_bytes))

        tar_data = tar_stream.getvalue()

        try:
            conn = DockerUnixConnection(self.socket_path, timeout=300.0)
            headers = {
                "Host": "localhost",
                "Content-Type": "application/x-tar",
                "Content-Length": str(len(tar_data))
            }
            conn.request("POST", f"/build?t={image_name}&rm=1", body=tar_data, headers=headers)
            res = conn.getresponse()
            raw = res.read().decode("utf-8", errors="replace")
            conn.close()
            logger.info(f"Docker build response status: {res.status}")
            return self.image_exists(image_name)
        except Exception as e:
            logger.error(f"Failed to build image {image_name} via Docker socket: {e}")
            return False

    def create_container(
        self,
        name: str,
        image: str,
        binds: List[str],
        port_bindings: Dict[str, List[Dict[str, str]]],
        memory_bytes: int = 134217728,  # 128 MB
        nano_cpus: int = 300000000,     # 0.3 CPU
        network_name: Optional[str] = None
    ) -> str:
        exposed_ports = {port: {} for port in port_bindings.keys()}
        if not network_name:
            _, network_name = self.resolve_host_environment()
        body = {
            "Image": image,
            "ExposedPorts": exposed_ports,
            "HostConfig": {
                "PortBindings": port_bindings,
                "Binds": binds,
                "Memory": memory_bytes,
                "NanoCpus": nano_cpus,
                "RestartPolicy": {"Name": "unless-stopped"}
            },
            "NetworkingConfig": {
                "EndpointsConfig": {
                    network_name: {}
                }
            }
        }
        status, data = self._request("POST", f"/containers/create?name={name}", body=body)
        if status in (200, 201) and isinstance(data, dict) and "Id" in data:
            return data["Id"]
        raise RuntimeError(f"Failed to create container {name} (status {status}): {data}")

    def start_container(self, name_or_id: str) -> bool:
        status, _ = self._request("POST", f"/containers/{name_or_id}/start")
        return status in (200, 204, 304)

    def stop_container(self, name_or_id: str, timeout: int = 2) -> bool:
        status, _ = self._request("POST", f"/containers/{name_or_id}/stop?t={timeout}")
        return status in (200, 204, 304)

    def restart_container(self, name_or_id: str, timeout: int = 2) -> bool:
        status, _ = self._request("POST", f"/containers/{name_or_id}/restart?t={timeout}")
        return status in (200, 204, 304)

    def remove_container(self, name_or_id: str, force: bool = True) -> bool:
        status, _ = self._request("DELETE", f"/containers/{name_or_id}?force={1 if force else 0}&v=1")
        return status in (200, 204, 404)

    def exec_command(self, name_or_id: str, cmd: List[str]) -> str:
        # 1. Create exec instance
        body = {
            "AttachStdout": True,
            "AttachStderr": True,
            "Cmd": cmd
        }
        status, data = self._request("POST", f"/containers/{name_or_id}/exec", body=body)
        if status not in (200, 201) or not isinstance(data, dict) or "Id" not in data:
            raise RuntimeError(f"Exec create failed: {data}")
        exec_id = data["Id"]

        # 2. Start exec
        start_body = {"Detach": False, "Tty": False}
        status, raw_output = self._request("POST", f"/exec/{exec_id}/start", body=start_body)
        if isinstance(raw_output, str):
            # Очистка мультиплексированных заголовков Docker stream (8 байт на чанк)
            clean_lines = []
            for line in raw_output.splitlines():
                clean_lines.append(line.strip())
            return "\n".join(clean_lines)
        return str(raw_output)


class ASLPortPool:
    """Менеджер выделения внешних портов для пользователей"""
    def __init__(self, ports_file: str = os.path.join(DATA_DIR, "asl_ports.json")):
        self.ports_file = ports_file
        self.allocations: Dict[str, Dict[str, int]] = {}
        self._load()

    def _load(self):
        if os.path.exists(self.ports_file):
            try:
                with open(self.ports_file, "r", encoding="utf-8") as f:
                    self.allocations = json.load(f)
            except Exception as e:
                logger.warning(f"Error loading {self.ports_file}: {e}")
                self.allocations = {}

    def _save(self):
        os.makedirs(os.path.dirname(self.ports_file), exist_ok=True)
        try:
            with open(self.ports_file, "w", encoding="utf-8") as f:
                json.dump(self.allocations, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving {self.ports_file}: {e}")

    def allocate(self, instance_key: str, docker_client: Optional[DockerClient] = None) -> tuple[int, int]:
        if instance_key in self.allocations:
            item = self.allocations[instance_key]
            return item["iax_port"], item["ami_port"]

        used_iax = {v["iax_port"] for v in self.allocations.values()}
        used_ami = {v["ami_port"] for v in self.allocations.values()}

        # Учесть порты, занятые любыми Docker-контейнерами на хосте
        docker_used_ports = set()
        if docker_client and docker_client.is_available():
            try:
                for c in docker_client.list_containers(all_containers=True):
                    for port_info in c.get("Ports", []):
                        hp = port_info.get("PublicPort")
                        if hp:
                            docker_used_ports.add(int(hp))
            except Exception as e:
                logger.debug(f"Could not inspect docker ports: {e}")

        iax_port = None
        for p in range(IAX_PORT_RANGE[0], IAX_PORT_RANGE[1]):
            if p not in used_iax and p not in docker_used_ports and not self._is_port_in_use(p, "udp"):
                iax_port = p
                break

        ami_port = None
        for p in range(AMI_PORT_RANGE[0], AMI_PORT_RANGE[1]):
            if p not in used_ami and p not in docker_used_ports and not self._is_port_in_use(p, "tcp"):
                ami_port = p
                break

        if not iax_port or not ami_port:
            raise RuntimeError("Port pool exhausted for AllStarLink instances!")

        self.allocations[instance_key] = {"iax_port": iax_port, "ami_port": ami_port}
        self._save()
        return iax_port, ami_port

    def release(self, instance_key: str):
        if instance_key in self.allocations:
            del self.allocations[instance_key]
            self._save()

    @staticmethod
    def _is_port_in_use(port: int, proto: str = "udp") -> bool:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM if proto == "udp" else socket.SOCK_STREAM)
        try:
            s.bind(("0.0.0.0", port))
            s.close()
            return False
        except OSError:
            return True


class ASLConfigGenerator:
    """Генератор конфигураций Asterisk / app_rpt для ноды пользователя"""

    @staticmethod
    def generate_configs(
        target_dir: str,
        node_number: str,
        node_password: str = "",
        callsign: str = "",
        proxdmr_secret: str = "proxdmr_secret_iax",
        ami_secret: str = "proxdmr_ami_secret",
        iax_port: int = 4569,
    ):
        os.makedirs(target_dir, exist_ok=True)
        norm_callsign = (callsign or "N0CALL").upper().strip()

        # 1. rpt.conf
        rpt_content = f"""; Auto-generated rpt.conf for ProxDMR user node {node_number}
[general]
node_lookup_method = dns

[nodes]
{node_number} = radio@127.0.0.1/{node_number},NONE
1999 = radio@127.0.0.1/1999,NONE
9999 = radio@127.0.0.1/1999,NONE

[{node_number}]
rxchannel = Local/pseudo
duplex = 0
hangtime = 0
althangtime = 0
holdofftelem = 1
telemdefault = 0
telemdynamic = 0
linkunkeyct = ct8
functions = functions
link_functions = functions
phone_functions = functions
telemetry = telemetry
morse = morse
statpost_program =
statpost_url =
tailmessagelist =
tailmessagetime = 0
tailsquashedlist =
tailsquashedtime = 0
idrecording = |i{norm_callsign}
idtalkover = |i{norm_callsign}

[1999]
rxchannel = Local/pseudo
duplex = 0
hangtime = 50
althangtime = 50
holdofftelem = 1
telemdefault = 0
telemdynamic = 0
linkunkeyct = ct8
functions = functions
link_functions = functions
phone_functions = functions
telemetry = telemetry
morse = morse
statpost_program =
statpost_url =
tailmessagelist =
tailmessagetime = 0
tailsquashedlist =
tailsquashedtime = 0
idrecording = |iPARROT
idtalkover = |iPARROT

[functions]
1 = ilink,1
2 = ilink,2
3 = ilink,3
4 = ilink,4
5 = ilink,5
6 = ilink,6
7 = ilink,7
11 = ilink,11
12 = ilink,12
13 = ilink,13
15 = ilink,15
16 = ilink,16
70 = ilink,5
71 = ilink,11
72 = ilink,12
73 = ilink,6
76 = ilink,6

[telemetry]
ct1 = |t(350,0,100,2048)(500,0,100,2048)(660,0,100,2048)
ct2 = |t(660,0,100,2048)(500,0,100,2048)(350,0,100,2048)
ct8 = |t(350,0,100,2048)
remotemon = |t(1209,0,50,2048)
remotetx = |t(1633,0,50,2048)
cmdmode = |t(900,90,100,2048)

[morse]
speed = 20
frequency = 800
amplitude = 4096
idpause = 500
yawk = 1
"""
        with open(os.path.join(target_dir, "rpt.conf"), "w", encoding="utf-8") as f:
            f.write(rpt_content)

        # 2. iax.conf
        reg_stanza = ""
        if node_password:
            reg_stanza = f"register => {node_number}:{node_password}@register.allstarlink.org\n"

        iax_content = f"""; Auto-generated iax.conf for ProxDMR user node {node_number}
[general]
bindport = 4569
bindaddr = 0.0.0.0
disallow = all
allow = g726aal2
allow = gsm
allow = ulaw
delayreject = yes
autokill = 9000
calltokenoptional = 0.0.0.0/0.0.0.0
{reg_stanza}
[proxdmr]
type = friend
context = iaxrpt
auth = md5
secret = {proxdmr_secret}
host = dynamic
disallow = all
allow = ulaw
transfer = no
requirecalltoken = no

[radio]
type = friend
context = radio-secure
auth = plaintext
disallow = all
allow = ulaw
allow = slin
host = 127.0.0.1
transfer = no
requirecalltoken = no
"""
        with open(os.path.join(target_dir, "iax.conf"), "w", encoding="utf-8") as f:
            f.write(iax_content)

        # 3. extensions.conf
        ext_content = f"""; Auto-generated extensions.conf for ProxDMR user node {node_number}
[general]
static = yes
writeprotect = yes

[iaxrpt]
exten => {node_number},1,Rpt({node_number},X)
same => n,Hangup()
exten => 1999,1,Rpt(1999,X)
same => n,Hangup()

[radio-secure]
exten => {node_number},1,Rpt({node_number})
exten => 1999,1,Rpt(1999)
"""
        with open(os.path.join(target_dir, "extensions.conf"), "w", encoding="utf-8") as f:
            f.write(ext_content)

        # 4. manager.conf
        mgr_content = f"""; Auto-generated manager.conf for ProxDMR AMI control
[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0

[proxdmr_ami]
secret = {ami_secret}
read = system,call,log,verbose,command,agent,user,config
write = system,call,log,verbose,command,agent,user,config
"""
        with open(os.path.join(target_dir, "manager.conf"), "w", encoding="utf-8") as f:
            f.write(mgr_content)


class ASLContainerManager:
    """Главный оркестратор мультитенантных контейнеров AllStarLink v3"""

    def __init__(self):
        self.docker = DockerClient()
        self.port_pool = ASLPortPool()
        self._netstats_cache: Dict[str, Tuple[float, Dict[str, Dict[str, Any]]]] = {}
        self._last_known_node_stats: Dict[str, Dict[str, Any]] = {}

    def _instance_key(self, user_id: str, node_number: str) -> str:
        clean_user = "".join(c for c in str(user_id) if c.isalnum() or c in ("-", "_"))
        clean_node = "".join(c for c in str(node_number) if c.isdigit())
        return f"{clean_user}_{clean_node}"

    def _container_name(self, instance_key: str) -> str:
        return f"asl_{instance_key}"

    def get_instance_status(self, user_id: str, node_number: str) -> Dict[str, Any]:
        key = self._instance_key(user_id, node_number)
        name = self._container_name(key)

        if not self.docker.is_available():
            return {
                "instance_key": key,
                "container_name": name,
                "status": "simulation_or_disabled",
                "running": False,
                "message": "Docker socket unavailable"
            }

        info = self.docker.inspect_container(name)
        if not info:
            return {
                "instance_key": key,
                "container_name": name,
                "status": "offline",
                "running": False
            }

        state = info.get("State", {})
        running = state.get("Running", False)
        status = state.get("Status", "unknown")

        networks = info.get("NetworkSettings", {}).get("Networks", {})
        ip_addr = None
        for n_name, n_info in networks.items():
            if n_info.get("IPAddress"):
                ip_addr = n_info["IPAddress"]
                break

        ports = self.port_pool.allocations.get(key, {})
        return {
            "instance_key": key,
            "container_name": name,
            "status": status,
            "running": running,
            "ip_address": ip_addr,
            "started_at": state.get("StartedAt"),
            "iax_port": ports.get("iax_port"),
            "ami_port": ports.get("ami_port"),
        }

    def start_instance(
        self,
        user_id: str,
        node_number: str,
        node_password: str = "",
        callsign: str = "",
        proxdmr_secret: str = "proxdmr_secret_iax",
        ami_secret: str = "proxdmr_ami_secret"
    ) -> Dict[str, Any]:
        key = self._instance_key(user_id, node_number)
        name = self._container_name(key)
        logger.info(f"Starting ASL3 instance {name} for node {node_number}")

        # 1. Выделение портов
        iax_port, ami_port = self.port_pool.allocate(key, docker_client=self.docker)

        # 2. Локальная директория конфигов (внутри контейнера proxdmr или хоста)
        inst_dir = os.path.join(INSTANCES_DIR, key)
        ASLConfigGenerator.generate_configs(
            target_dir=inst_dir,
            node_number=node_number,
            node_password=node_password,
            callsign=callsign,
            proxdmr_secret=proxdmr_secret,
            ami_secret=ami_secret,
            iax_port=iax_port
        )

        # Путь директории на хосте для bind-mount и имя сети
        host_data_dir, network_name = self.docker.resolve_host_environment()
        host_inst_dir = f"{host_data_dir}/asl_instances/{key}"

        if not self.docker.is_available():
            logger.warning(f"Docker unavailable; instance {name} configured in mockup mode")
            return {
                "instance_key": key,
                "container_name": name,
                "status": "mockup_started",
                "running": True,
                "iax_port": iax_port,
                "ami_port": ami_port
            }

        # Ensure image is present or built
        self.docker.ensure_asl_image()

        # 3. Проверка существующего контейнера
        existing = self.docker.inspect_container(name)
        if existing:
            if existing.get("State", {}).get("Running"):
                logger.info(f"Container {name} is already running. Restarting on server startup/connect to clear stale sessions...")
                try:
                    restarted = self.docker.restart_container(name, timeout=2)
                    if not restarted:
                        self.docker.stop_container(name, timeout=2)
                        self.docker.start_container(name)
                    logger.info(f"Container {name} restarted successfully on server startup/connect")
                    self.wait_until_ready(user_id, node_number, timeout=8.0)
                    return self.get_instance_status(user_id, node_number)
                except Exception as e:
                    logger.warning(f"Error restarting existing running container {name}: {e}")
            else:
                logger.info(f"Attempting to start existing stopped container {name}")
                if self.docker.start_container(name):
                    logger.info(f"Existing container {name} started successfully")
                    self.wait_until_ready(user_id, node_number, timeout=8.0)
                    return self.get_instance_status(user_id, node_number)
                logger.info(f"Removing stopped container {name} before recreation")
                self.docker.remove_container(name, force=True)

        # 4. Создание контейнера
        binds = [
            f"{host_inst_dir}/rpt.conf:/etc/asterisk/rpt.conf:ro",
            f"{host_inst_dir}/iax.conf:/etc/asterisk/iax.conf:ro",
            f"{host_inst_dir}/extensions.conf:/etc/asterisk/extensions.conf:ro",
            f"{host_inst_dir}/manager.conf:/etc/asterisk/manager.conf:ro"
        ]
        port_bindings = {
            "4569/udp": [{"HostPort": str(iax_port)}],
            "5038/tcp": [{"HostPort": str(ami_port)}]
        }

        container_id = self.docker.create_container(
            name=name,
            image=ASL_IMAGE,
            binds=binds,
            port_bindings=port_bindings,
            memory_bytes=134217728,  # 128 MB RAM max
            nano_cpus=300000000,      # 0.3 CPU max
            network_name=network_name
        )

        # 5. Запуск
        self.docker.start_container(container_id)
        logger.info(f"Container {name} ({container_id[:12]}) successfully started on UDP:{iax_port}, AMI:{ami_port}")

        return self.get_instance_status(user_id, node_number)

    def stop_instance(self, user_id: str, node_number: str) -> bool:
        key = self._instance_key(user_id, node_number)
        name = self._container_name(key)
        logger.info(f"Stopping instance {name}")
        if not self.docker.is_available():
            return True
        return self.docker.stop_container(name, timeout=2)

    def restart_instance(self, user_id: str, node_number: str) -> bool:
        key = self._instance_key(user_id, node_number)
        name = self._container_name(key)
        logger.info(f"Restarting instance {name}")
        if not self.docker.is_available():
            return True
        return self.docker.restart_container(name, timeout=2)

    def stop_all_instances(self) -> None:
        """Останавливает все запущенные ASL контейнеры (при выключении/перезагрузке сервера)"""
        if not self.docker.is_available():
            return
        try:
            containers = self.docker.list_containers(all_containers=False)
            for c in containers:
                names = c.get("Names") or []
                for n in names:
                    clean_name = n.lstrip("/")
                    if clean_name.startswith("asl_"):
                        logger.info(f"[ASL] Stopping container {clean_name} on server shutdown")
                        self.docker.stop_container(clean_name, timeout=2)
        except Exception as e:
            logger.warning(f"[ASL] Error stopping all instances: {e}")

    def delete_instance(self, user_id: str, node_number: str) -> bool:
        key = self._instance_key(user_id, node_number)
        name = self._container_name(key)
        logger.info(f"Permanently deleting instance {name} and releasing resources")

        # 1. Остановка и удаление контейнера
        if self.docker.is_available():
            self.docker.remove_container(name, force=True)

        # 2. Удаление директории конфигов
        inst_dir = os.path.join(INSTANCES_DIR, key)
        if os.path.exists(inst_dir):
            shutil.rmtree(inst_dir, ignore_errors=True)

        # 3. Освобождение портов
        self.port_pool.release(key)
        logger.info(f"Instance {name} purged successfully")
        return True

    def execute_asterisk_cmd(self, user_id: str, node_number: str, cmd: str) -> str:
        key = self._instance_key(user_id, node_number)
        name = self._container_name(key)
        if not self.docker.is_available():
            return f"Mock response for cmd '{cmd}' on {name}"
        try:
            return self.docker.exec_command(name, ["asterisk", "-rx", cmd])
        except Exception as e:
            logger.debug(f"execute_asterisk_cmd failed on {name} for '{cmd}': {e}")
            return ""

    def wait_until_ready(self, user_id: str, node_number: str, timeout: float = 8.0) -> bool:
        """Ожидает полной готовности ядра Asterisk и ноды в app_rpt"""
        start = time.time()
        while time.time() - start < timeout:
            res = self.execute_asterisk_cmd(user_id, node_number, f"rpt nodes {node_number}")
            if "CONNECTED NODES" in res:
                logger.info(f"ASL node {node_number} fully initialized in app_rpt in {time.time() - start:.2f}s")
                return True
            time.sleep(0.25)
        logger.warning(f"ASL instance for node {node_number} wait_until_ready timed out after {timeout}s")
        return False

    def lookup_node_ip(self, user_id: str, node_number: str, target_node: str) -> Optional[str]:
        """Определение IP адреса ноды через Asterisk CLI (rpt lookup) или AllStar справочник."""
        target_node = str(target_node).strip()
        if target_node == "1999":
            return "127.0.0.1"
        try:
            out = self.execute_asterisk_cmd(user_id, node_number, f"rpt lookup {target_node}")
            m = re.search(r"@([0-9\.]+)", out)
            if m:
                ip = m.group(1).strip()
                if ip and ip != "0.0.0.0":
                    return ip
        except Exception as e:
            logger.debug(f"rpt lookup error for {target_node}: {e}")

        # Fallback to allstar_dir_mgr
        try:
            from allstar_directory import allstar_dir_mgr
            info = allstar_dir_mgr.get_node_info(target_node)
            if info and info.get("ip"):
                return info["ip"]
        except Exception as e:
            logger.debug(f"allstar_dir_mgr lookup error for {target_node}: {e}")

        return None

    def get_iax_channel_state(self, user_id: str, node_number: str, target_ip: Optional[str], target_node: str) -> Dict[str, Any]:
        """Проверка состояния IAX2 канала для целевого узла или IP через iax2 show channels."""
        target_node = str(target_node).strip()
        target_ip = str(target_ip).strip() if target_ip else ""
        try:
            out = self.execute_asterisk_cmd(user_id, node_number, "iax2 show channels")
            for line in out.splitlines():
                clean_line = re.sub(r'[\x00-\x1f\x7f-\xff]', '', line)
                if "172.18." in clean_line or "IAX2/proxdmr" in clean_line:
                    continue
                match = False
                if target_ip and target_ip in clean_line:
                    match = True
                elif target_node and target_node in clean_line:
                    match = True
                if match:
                    parts = clean_line.split()
                    if parts and "IAX2/" in parts[0]:
                        return {
                            "exists": True,
                            "channel": parts[0],
                            "first_msg": parts[-2] if len(parts) >= 2 else "",
                            "last_msg": parts[-1] if len(parts) >= 1 else ""
                        }
        except Exception as e:
            logger.debug(f"get_iax_channel_state error: {e}")
        return {"exists": False, "channel": "", "first_msg": "", "last_msg": ""}

    def run_disconnect_procedure(
        self,
        user_id: str,
        node_number: str,
        target_node: str = "all",
        show_status_banner: bool = True,
        show_card_effects: bool = True,
        step_cb: Optional[Callable[[Dict[str, Any]], None]] = None
    ) -> Dict[str, Any]:
        """
        Изолированная процедура отключения AllStarLink с контролем через app_rpt и chan_iax2.
        Возвращает: {"success": bool, "had_links": bool, "node": str}
        """
        target_node = str(target_node or "").strip()
        is_all = target_node in ("all", "*73", "*76", "0", "")
        current_links = self.get_connected_links(user_id, node_number)
        prev_node = current_links[0]["node"] if current_links else ""
        disc_node_str = target_node if not is_all else (prev_node or "all")

        # Если сброс 'all' и активных линков уже нет:
        if is_all and not current_links:
            chan_check = self.get_iax_channel_state(user_id, node_number, None, "")
            if not chan_check.get("exists"):
                try:
                    self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink 6")
                except Exception:
                    pass
                logger.info(f"[ASL-PROC] run_disconnect_procedure (all): already 0 links on {node_number}")
                return {"success": True, "had_links": False, "node": ""}

        # Уведомление о начале процедуры
        code_init = "disc_init" if (disc_node_str and disc_node_str != "all") else "disc_all_init"
        if step_cb:
            try:
                step_cb({
                    "proc": "disconnect",
                    "state": "progress",
                    "tone": "neutral",
                    "code": code_init,
                    "node": disc_node_str,
                    "show_status_banner": show_status_banner,
                    "show_card_effects": show_card_effects
                })
            except Exception as e:
                logger.warning(f"[ASL-PROC] step_cb init error: {e}")

        # Отправляем команды отключения в Asterisk
        logger.info(f"[ASL-PROC] Starting disconnect procedure on {node_number} (target={disc_node_str})")
        if is_all:
            try:
                self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink 6")
                self.execute_asterisk_cmd(user_id, node_number, f"rpt fun {node_number} *76")
                for lk in current_links:
                    n = lk.get("node")
                    if n:
                        self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink 1 {n}")
                        self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink 11 {n}")
            except Exception as ex:
                logger.warning(f"[ASL-PROC] Error sending disconnect all commands: {ex}")
        else:
            try:
                self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink 1 {target_node}")
                self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink 11 {target_node}")
            except Exception as ex:
                logger.warning(f"[ASL-PROC] Error sending disconnect command for {target_node}: {ex}")

        # Цикл верификации разрыва (до 2.5 сек, шаг 0.10 сек)
        t0 = time.time()
        closing_sent = False
        while time.time() - t0 < 2.5:
            time.sleep(0.10)
            chk_links = self.get_connected_links(user_id, node_number)
            still_connected = bool(chk_links) if is_all else any(str(lk.get("node")) == str(target_node) for lk in chk_links)

            elapsed = time.time() - t0
            if elapsed > 0.6 and (still_connected or not is_all):
                try:
                    chan_out = self.execute_asterisk_cmd(user_id, node_number, "iax2 show channels")
                    for line in chan_out.splitlines():
                        if "172.18." in line or "IAX2/proxdmr" in line:
                            continue
                        if (is_all and "IAX2/" in line) or (not is_all and target_node in line):
                            parts = line.split()
                            if parts and parts[0].startswith("IAX2/"):
                                if not closing_sent and step_cb:
                                    closing_sent = True
                                    try:
                                        step_cb({
                                            "proc": "disconnect",
                                            "state": "progress",
                                            "tone": "neutral",
                                            "code": "disc_closing",
                                            "node": disc_node_str,
                                            "show_status_banner": show_status_banner,
                                            "show_card_effects": show_card_effects
                                        })
                                    except Exception:
                                        pass
                                logger.info(f"[ASL-PROC] Force hanging up closing channel {parts[0]}")
                                self.execute_asterisk_cmd(user_id, node_number, f"channel request hangup {parts[0]}")
                except Exception as ex:
                    logger.debug(f"[ASL-PROC] Hangup loop error: {ex}")

            if not still_connected:
                if is_all:
                    try:
                        c_out = self.execute_asterisk_cmd(user_id, node_number, "iax2 show channels")
                        has_ext = any(p.startswith("IAX2/") and "172.18." not in l and "proxdmr" not in l for l in c_out.splitlines() for p in [l.split()[0]] if l.split())
                        if has_ext and elapsed < 1.4:
                            continue
                    except Exception:
                        pass

                code_ok = "disc_all_ok" if (is_all and (disc_node_str == "all" or not disc_node_str)) else "disc_ok"
                logger.info(f"[ASL-PROC] Disconnect SUCCESS on {node_number} in {elapsed:.2f}s (node={disc_node_str})")
                if step_cb:
                    try:
                        step_cb({
                            "proc": "disconnect",
                            "state": "done",
                            "tone": "positive",
                            "code": code_ok,
                            "node": disc_node_str,
                            "show_status_banner": show_status_banner,
                            "show_card_effects": show_card_effects
                        })
                    except Exception as e:
                        logger.warning(f"[ASL-PROC] step_cb done error: {e}")
                return {"success": True, "had_links": True, "node": disc_node_str}

        logger.warning(f"[ASL-PROC] Disconnect TIMEOUT on {node_number} after 2.5s (node={disc_node_str})")
        if step_cb:
            try:
                step_cb({
                    "proc": "disconnect",
                    "state": "failed",
                    "tone": "negative",
                    "code": "disc_timeout",
                    "node": disc_node_str,
                    "show_status_banner": show_status_banner,
                    "show_card_effects": show_card_effects
                })
            except Exception:
                pass
        return {"success": False, "had_links": True, "node": disc_node_str}

    def run_connect_procedure(
        self,
        user_id: str,
        node_number: str,
        target_node: str,
        mode: str = "*2",
        show_status_banner: bool = True,
        show_card_effects: bool = True,
        step_cb: Optional[Callable[[Dict[str, Any]], None]] = None
    ) -> Dict[str, Any]:
        """
        Изолированная процедура подключения к AllStarLink узлу с глубокой верификацией IAX2/app_rpt.
        Исключает ложное зажигание статуса connected (особенно для закрытых узлов, таких как #27339).
        Возвращает: {"success": bool, "node": str, "mode": str, "ip": str, "links": list, "reason": str}
        """
        target_node = str(target_node).strip()
        ilink_type = "3" if (target_node in ("1999", "9999") or mode in ("perm", "*3", "transceive")) else "2"
        mode_label = "*3" if ilink_type == "3" else "*2"

        # 1. DNS Поиск
        if step_cb:
            try:
                step_cb({
                    "proc": "connect",
                    "state": "progress",
                    "tone": "neutral",
                    "code": "conn_dns",
                    "node": target_node,
                    "mode": mode_label,
                    "show_status_banner": show_status_banner,
                    "show_card_effects": show_card_effects
                })
            except Exception as e:
                logger.warning(f"[ASL-PROC] step_cb dns error: {e}")

        ip = self.lookup_node_ip(user_id, node_number, target_node)
        if not ip:
            logger.warning(f"[ASL-PROC] DNS lookup failed for node {target_node}")
            if step_cb:
                try:
                    step_cb({
                        "proc": "connect",
                        "state": "failed",
                        "tone": "negative",
                        "code": "conn_dns_fail",
                        "node": target_node,
                        "mode": mode_label,
                        "show_status_banner": show_status_banner,
                        "show_card_effects": show_card_effects
                    })
                except Exception:
                    pass
            return {"success": False, "reason": "dns_fail", "node": target_node, "mode": mode_label}

        # 2. Вызов IAX2
        logger.info(f"[ASL-PROC] Calling node {target_node} at {ip} (ilink {ilink_type})")
        if step_cb:
            try:
                step_cb({
                    "proc": "connect",
                    "state": "progress",
                    "tone": "neutral",
                    "code": "conn_calling",
                    "node": target_node,
                    "mode": mode_label,
                    "ip": ip,
                    "show_status_banner": show_status_banner,
                    "show_card_effects": show_card_effects
                })
            except Exception as e:
                logger.warning(f"[ASL-PROC] step_cb calling error: {e}")

        self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink {ilink_type} {target_node}")

        # 3. Цикл контроля рукопожатия и допуска app_rpt (до 6.5 сек, шаг 0.12 сек)
        t0 = time.time()
        saw_channel = False
        saw_token = False
        saw_accept_or_connecting = False
        established_since = None
        first_chan_seen_time = None

        while time.time() - t0 < 6.5:
            poll_interval = 0.04 if (time.time() - t0 < 1.5) else 0.12
            time.sleep(poll_interval)
            links = self.get_connected_links(user_id, node_number)
            iax = self.get_iax_channel_state(user_id, node_number, ip, target_node)
            matching_link = next((lk for lk in links if str(lk.get("node")) == target_node), None)

            if matching_link:
                if matching_link.get("connecting"):
                    saw_accept_or_connecting = True
                    if not saw_token and step_cb:
                        saw_token = True
                        try:
                            step_cb({
                                "proc": "connect",
                                "state": "progress",
                                "tone": "neutral",
                                "code": "conn_verifying",
                                "node": target_node,
                                "mode": mode_label,
                                "ip": ip,
                                "show_status_banner": show_status_banner,
                                "show_card_effects": show_card_effects
                            })
                        except Exception:
                            pass
                else:
                    saw_accept_or_connecting = True
                    if established_since is None:
                        established_since = time.time()
                        if step_cb:
                            try:
                                step_cb({
                                    "proc": "connect",
                                    "state": "progress",
                                    "tone": "neutral",
                                    "code": "conn_verifying",
                                    "node": target_node,
                                    "mode": mode_label,
                                    "ip": ip,
                                    "show_status_banner": show_status_banner,
                                    "show_card_effects": show_card_effects
                                })
                            except Exception:
                                pass

                    # Окно контрольной стабилизации 650 мс
                    if time.time() - established_since >= 0.65:
                        curr_links = self.get_connected_links(user_id, node_number)
                        curr_match = next((lk for lk in curr_links if str(lk.get("node")) == target_node), None)
                        if curr_match and not curr_match.get("connecting"):
                            logger.info(f"[ASL-PROC] Connect SUCCESS to #{target_node} ({mode_label}) in {time.time() - t0:.2f}s")
                            if step_cb:
                                try:
                                    step_cb({
                                        "proc": "connect",
                                        "state": "done",
                                        "tone": "positive",
                                        "code": "conn_ok",
                                        "node": target_node,
                                        "mode": mode_label,
                                        "ip": ip,
                                        "show_status_banner": show_status_banner,
                                        "show_card_effects": show_card_effects
                                    })
                                except Exception:
                                    pass
                            return {
                                "success": True,
                                "node": target_node,
                                "mode": mode_label,
                                "ip": ip,
                                "links": curr_links
                            }

            else:
                if established_since is not None:
                    logger.warning(f"[ASL-PROC] Node #{target_node} dropped immediately after establish (access denied / HANGUP)")
                    self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink 6")
                    if step_cb:
                        try:
                            step_cb({
                                "proc": "connect",
                                "state": "failed",
                                "tone": "negative",
                                "code": "conn_rejected",
                                "node": target_node,
                                "mode": mode_label,
                                "ip": ip,
                                "show_status_banner": show_status_banner,
                                "show_card_effects": show_card_effects
                            })
                        except Exception:
                            pass
                    return {"success": False, "reason": "rejected", "node": target_node, "mode": mode_label}

                if iax.get("exists"):
                    saw_channel = True
                    if first_chan_seen_time is None:
                        first_chan_seen_time = time.time()
                    last_msg = str(iax.get("last_msg", ""))
                    if ("CTOKEN" in last_msg or "NEW" in last_msg) and not saw_token:
                        saw_token = True
                        if step_cb:
                            try:
                                step_cb({
                                    "proc": "connect",
                                    "state": "progress",
                                    "tone": "neutral",
                                    "code": "conn_token",
                                    "node": target_node,
                                    "mode": mode_label,
                                    "ip": ip,
                                    "show_status_banner": show_status_banner,
                                    "show_card_effects": show_card_effects
                                })
                            except Exception:
                                pass
                    elif "ACCEPT" in last_msg:
                        saw_accept_or_connecting = True
                        if step_cb:
                            try:
                                step_cb({
                                    "proc": "connect",
                                    "state": "progress",
                                    "tone": "neutral",
                                    "code": "conn_verifying",
                                    "node": target_node,
                                    "mode": mode_label,
                                    "ip": ip,
                                    "show_status_banner": show_status_banner,
                                    "show_card_effects": show_card_effects
                                })
                            except Exception:
                                pass
                else:
                    if saw_accept_or_connecting or saw_channel:
                        time.sleep(0.12)
                        recheck_links = self.get_connected_links(user_id, node_number)
                        if not any(str(lk.get("node")) == target_node for lk in recheck_links):
                            logger.warning(f"[ASL-PROC] Remote rejected connection for #{target_node} (channel closed by peer)")
                            self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink 6")
                            if step_cb:
                                try:
                                    step_cb({
                                        "proc": "connect",
                                        "state": "failed",
                                        "tone": "negative",
                                        "code": "conn_rejected",
                                        "node": target_node,
                                        "mode": mode_label,
                                        "ip": ip,
                                        "show_status_banner": show_status_banner,
                                        "show_card_effects": show_card_effects
                                    })
                                except Exception:
                                    pass
                            return {"success": False, "reason": "rejected", "node": target_node, "mode": mode_label}

        logger.warning(f"[ASL-PROC] Connect timed out for #{target_node} after 6.5s")
        self.execute_asterisk_cmd(user_id, node_number, f"rpt cmd {node_number} ilink 6")
        code_fail = "conn_rejected" if saw_accept_or_connecting else "conn_timeout"
        if step_cb:
            try:
                step_cb({
                    "proc": "connect",
                    "state": "failed",
                    "tone": "negative",
                    "code": code_fail,
                    "node": target_node,
                    "mode": mode_label,
                    "ip": ip,
                    "show_status_banner": show_status_banner,
                    "show_card_effects": show_card_effects
                })
            except Exception:
                pass
        return {"success": False, "reason": "rejected" if saw_accept_or_connecting else "timeout", "node": target_node, "mode": mode_label}

    def connect_node(self, user_id: str, node_number: str, target_node: str, mode: str = "perm", add_mode: bool = False) -> str:
        """Подключение к целевой ноде Всемирной сети."""
        res = self.run_connect_procedure(user_id, node_number, target_node, mode, show_status_banner=False, show_card_effects=False)
        return "Connected" if res.get("success") else f"Failed: {res.get('reason')}"

    def disconnect_node(self, user_id: str, node_number: str, target_node: str) -> str:
        """Отключение от целевой ноды."""
        res = self.run_disconnect_procedure(user_id, node_number, target_node, show_status_banner=False, show_card_effects=False)
        return "Disconnected" if res.get("success") else "Failed"

    def get_connected_links(self, user_id: str, node_number: str) -> List[Dict[str, Any]]:
        """
        Парсинг списка активных линков с детализацией (*2 Monitor vs *3 Transceive)
        из CLI Asterisk (rpt xnode / rpt lstats).
        Возвращает: [{"node": "41522", "mode": "*2", "direction": "OUT", "flag": "🇬🇧", "clients": 1}, ...]
        """
        links = []
        try:
            output = self.execute_asterisk_cmd(user_id, node_number, f"rpt xnode {node_number}")
            alinks_line = ""
            for line in output.splitlines():
                if line.startswith("RPT_ALINKS="):
                    alinks_line = line.split("=", 1)[1].strip()
                    break

            if alinks_line:
                # Пример: 3,51010RU,2143RU,N0CALLTU
                parts = alinks_line.split(",")
                for token in parts[1:]:
                    token = token.strip()
                    if not token:
                        continue
                    if not re.match(r"^\d+", token):
                        continue

                    import re
                    m = re.match(r"^(\d+)([TRCtrc])?([UKDukd])?$", token)
                    if m:
                        node_clean = m.group(1)
                        mode_char = (m.group(2) or "R").upper()
                        keyed_char = (m.group(3) or "U").upper()
                        is_connecting = (mode_char == "C")
                        mode_flag = "*3" if mode_char == "T" else "*2"
                        is_keyed = (keyed_char == "K")
                        direction = "IN" if keyed_char == "D" else "OUT"

                        if node_clean != str(node_number):
                            from allstar_directory import allstar_dir_mgr as allstar_dir
                            info = allstar_dir.get_node_info(node_clean)
                            flag = info.get("flag") or "🌐"
                            links.append({
                                "node": node_clean,
                                "mode": mode_flag,
                                "direction": direction,
                                "flag": flag,
                                "clients": 1,
                                "keyed": is_keyed,
                                "connecting": is_connecting,
                                "status": "connecting" if is_connecting else "established"
                            })

            if not links:
                lstats_output = self.execute_asterisk_cmd(user_id, node_number, f"rpt lstats {node_number}")
                for line in lstats_output.splitlines():
                    line = line.strip()
                    if "ESTABLISHED" in line:
                        parts = line.split()
                        if parts and parts[0].isdigit() and parts[0] != str(node_number):
                            node_clean = parts[0]
                            direction = parts[3] if len(parts) > 3 else "OUT"
                            from allstar_directory import detect_country_flag
                            country, flag = detect_country_flag("", "", node_clean)
                            links.append({
                                "node": node_clean,
                                "mode": "*2",
                                "direction": direction,
                                "flag": flag or "🌐",
                                "clients": 1
                            })
        except Exception as e:
            logger.warning(f"Error parsing connected links for node {node_number}: {e}")

        unique = []
        seen = set()
        for l in links:
            if l["node"] not in seen:
                seen.add(l["node"])
                unique.append(l)
        return unique

    def get_connected_nodes(self, user_id: str, node_number: str) -> List[str]:
        """Парсинг списка подключенных узлов через get_connected_links"""
        try:
            links = self.get_connected_links(user_id, node_number)
            if links:
                return [l["node"] for l in links if not l.get("connecting")]

            # Запасной парсинг через rpt nodes
            connected = []
            output = self.execute_asterisk_cmd(user_id, node_number, f"rpt nodes {node_number}")
            for line in output.splitlines():
                line = line.strip()
                if line.startswith("*") or not line:
                    continue
                for item in line.replace(",", " ").split():
                    clean = item.strip().lstrip("TMCDtmcd")
                    if clean.isdigit() and clean != str(node_number):
                        connected.append(clean)
            return list(dict.fromkeys(connected))
        except Exception as e:
            logger.warning(f"Error getting connected nodes for node {node_number}: {e}")
            return []




    def get_node_netstats(self, user_id: str, node_number: str) -> Dict[str, Dict[str, Any]]:
        """
        Parses live network latency (RTT), jitter, packet loss from Asterisk CLI
        via `rpt lstats` (mapping nodes to peer IPs) and `iax2 show netstats` (measuring IAX2 UDP telemetry).
        Returns a dictionary indexed by both node number and peer IP.
        """
        key = self._instance_key(user_id, node_number)
        now = time.time()
        cached = self._netstats_cache.get(key)
        if cached and (now - cached[0]) < 2.0:
            return cached[1]

        res: Dict[str, Dict[str, Any]] = {}
        try:
            # 1. Map connected nodes to their remote IPs
            lstats_out = self.execute_asterisk_cmd(user_id, node_number, f"rpt lstats {node_number}")
            ip_to_node = {}
            node_to_ip = {}
            for line in lstats_out.splitlines():
                parts = line.split()
                if len(parts) >= 2 and parts[0].isdigit() and parts[1] != "(none)":
                    n = parts[0]
                    ip = parts[1]
                    ip_to_node[ip] = n
                    node_to_ip[n] = ip

            # 2. Extract RTT, jitter, loss from iax2 show netstats
            netstats_out = self.execute_asterisk_cmd(user_id, node_number, "iax2 show netstats")
            for line in netstats_out.splitlines():
                m = re.search(r"IAX2/([0-9\.]+)(?::\d+)?[^\s]*\s+(\d+)\s+([-\d]+)\s+([-\d]+)\s+([-\d]+)\s+([-\d]+)", line)
                if m:
                    ip = m.group(1)
                    raw_rtt = int(m.group(2))
                    raw_jit = int(m.group(3))
                    raw_loss_pct = int(m.group(6))

                    rtt = raw_rtt if (0 < raw_rtt < 3000) else None
                    jitter = raw_jit if raw_jit >= 0 else 0
                    loss_pct = float(raw_loss_pct) if raw_loss_pct >= 0 else 0.0

                    node = ip_to_node.get(ip)
                    entry = {
                        "node": node,
                        "ip": ip,
                        "rtt": rtt,
                        "jitter": jitter,
                        "loss_pct": loss_pct
                    }
                    if node:
                        res[node] = entry
                        self._last_known_node_stats[node] = entry
                    res[ip] = entry
                    self._last_known_node_stats[ip] = entry

            # 3. For any connected nodes that didn't have measured IAX traffic yet, link their IP
            for n, ip in node_to_ip.items():
                if n not in res:
                    entry = {
                        "node": n,
                        "ip": ip,
                        "rtt": None,
                        "jitter": 0,
                        "loss_pct": 0.0
                    }
                    res[n] = entry
                    if ip not in res:
                        res[ip] = entry

            self._netstats_cache[key] = (now, res)
        except Exception as e:
            logger.debug(f"[ASL] get_node_netstats error: {e}")

        return res


# Глобальный экземпляр менеджера контейнеров
asl_container_mgr = ASLContainerManager()
