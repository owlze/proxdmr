import unittest
import time
from src.ping import ClientPingService


class TestClientPingService(unittest.TestCase):
    def setUp(self):
        self.service = ClientPingService()
        self.service.history.clear()

    def test_record_client_ping_basic(self):
        rtt, loss = self.service.record_client_ping(25, is_lost=False)
        self.assertEqual(rtt, 25)
        self.assertEqual(loss, 0.0)

    def test_record_client_ping_with_client_reported_loss(self):
        rtt, loss = self.service.record_client_ping(15, is_lost=False, client_loss=25.5)
        self.assertEqual(rtt, 15)
        self.assertEqual(loss, 25.5)

    def test_record_client_ping_lost_packet(self):
        self.service.record_client_ping(20, is_lost=False)
        self.service.record_client_ping(None, is_lost=True)
        self.assertEqual(len(self.service.history), 2)
        self.assertEqual(self.service.get_packet_loss(window_sec=60), 50.0)


if __name__ == "__main__":
    unittest.main()
