import os
import re
import shutil
import subprocess
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
JS_DIR = os.path.join(ROOT_DIR, "src", "static", "js")


def get_all_js_files():
    js_files = []
    for root, _, files in os.walk(JS_DIR):
        for f in files:
            if f.endswith(".js"):
                js_files.append(os.path.join(root, f))
    return js_files


def find_node_executable():
    node_in_path = shutil.which("node")
    if node_in_path:
        return node_in_path
    common_paths = [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        "/usr/local/bin/node",
        "/usr/bin/node"
    ]
    for p in common_paths:
        if os.path.exists(p):
            return p
    return None


class TestJsSyntax(unittest.TestCase):
    """
    Automated regression and syntax tests for all frontend JavaScript / ES Modules.
    Catches duplicate export names (e.g. SyntaxError: duplicate export name 'handleTtsSpeech'),
    syntax errors, and invalid ES module structures before deployment.
    """

    def test_no_duplicate_exports_static(self):
        """
        Static regex-based check across all JS files ensuring no symbol
        is declared in both inline export and export {...} block, or exported multiple times.
        """
        inline_export_re = re.compile(
            r"^\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([a-zA-Z0-9_$]+)",
            re.MULTILINE
        )
        export_block_re = re.compile(r"export\s*\{([\s\S]*?)\};", re.MULTILINE)

        files = get_all_js_files()
        self.assertGreater(len(files), 0, "No JS files found in src/static/js")

        duplicate_errors = []

        for fpath in files:
            rel_path = os.path.relpath(fpath, ROOT_DIR)
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()

            # Find all inline exports
            inline_exports = []
            for match in inline_export_re.finditer(content):
                name = match.group(1)
                inline_exports.append(name)

            # Find all block exports
            block_exports = []
            for block in export_block_re.finditer(content):
                block_content = block.group(1)
                for item in block_content.split(","):
                    item = item.strip()
                    if not item or item.startswith("//") or item.startswith("/*"):
                        continue
                    # Handle 'name as alias' or just 'name'
                    parts = re.split(r"\s+as\s+", item)
                    name = parts[0].strip()
                    if name and re.match(r"^[a-zA-Z0-9_$]+$", name):
                        block_exports.append(name)

            # Check duplicates between inline and block exports
            all_exports = inline_exports + block_exports
            seen = set()
            duplicates = set()
            for name in all_exports:
                if name in seen:
                    duplicates.add(name)
                seen.add(name)

            if duplicates:
                duplicate_errors.append(
                    f"{rel_path}: Duplicate export(s): {', '.join(sorted(duplicates))}"
                )

        if duplicate_errors:
            self.fail(
                "Duplicate export names detected in JavaScript modules:\n" +
                "\n".join(duplicate_errors)
            )

    def test_v8_module_syntax_with_node(self):
        """
        Parses every JS file using Node.js V8 engine (vm.SourceTextModule),
        matching the exact ECMAScript module parser used by modern web browsers.
        """
        node_bin = find_node_executable()
        if not node_bin:
            self.skipTest("Node.js executable not found, skipping V8 ES module validation.")

        node_script = r"""
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = process.argv[1] || process.argv[2];

function getAllJsFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllJsFiles(fullPath));
        } else if (file.endsWith('.js')) {
            results.push(fullPath);
        }
    });
    return results;
}

const files = getAllJsFiles(jsDir);
const errors = [];

files.forEach(f => {
    const code = fs.readFileSync(f, 'utf8');
    try {
        new vm.SourceTextModule(code);
    } catch(e) {
        errors.push({ file: f, error: e.message });
    }
});

if (errors.length > 0) {
    console.error(JSON.stringify(errors));
    process.exit(1);
} else {
    console.log(`OK: ${files.length} modules validated`);
    process.exit(0);
}
"""
        proc = subprocess.run(
            [node_bin, "--experimental-vm-modules", "-e", node_script, JS_DIR],
            capture_output=True,
            text=True
        )

        if proc.returncode != 0:
            self.fail(f"V8 ES Module validation failed:\n{proc.stderr}\n{proc.stdout}")

    def test_no_mojibake(self):
        """
        Ensures no JS files contain corrupted Unicode/mojibake sequences
        such as 'пёЏ' (CP1251 decoded UTF-8 representation of \uFE0F variation selector).
        """
        mojibake_patterns = ["пёЏ", "пёЦ", "пё", "Р°Р", "Ã©", "â€"]
        files = get_all_js_files()
        errors = []
        for fpath in files:
            rel_path = os.path.relpath(fpath, ROOT_DIR)
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                for line_no, line in enumerate(f, 1):
                    for pat in ["пёЏ", "пёЦ"]:
                        if pat in line:
                            errors.append(f"{rel_path}:{line_no}: contains mojibake '{pat}': {line.strip()[:60]}")
        if errors:
            self.fail("Mojibake / corrupted encoding sequences detected:\n" + "\n".join(errors))


if __name__ == "__main__":
    unittest.main()
