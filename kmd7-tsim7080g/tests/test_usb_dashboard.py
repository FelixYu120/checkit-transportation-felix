import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('usb_dashboard',Path(__file__).resolve().parents[1]/'tools/usb_dashboard.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class StateTests(unittest.TestCase):
    def test_frame_and_disconnect(self):
        s=m.State();s.usb=True
        s.line('[TARGETS] 1')
        s.line('id=23 range=112.50m speed=-1.05km/h (0.65mph) approaching angle=18.39deg signal=61.65dB')
        self.assertFalse(s.snapshot()['online'])
        s.line('[FRAME] 1')
        self.assertEqual(s.snapshot()['targets'][0]['speed_kmh'],-1.05)
        s.line('[TARGETS] 0');s.line('[FRAME] 2')
        self.assertTrue(s.snapshot()['online'])
        self.assertEqual(s.snapshot()['targets'],[])
        s.disconnect();self.assertFalse(s.snapshot()['online'])
    def test_incomplete_and_stale(self):
        s=m.State();s.usb=True
        s.line('[TARGETS] 1');s.line('[FRAME] 1')
        self.assertFalse(s.snapshot()['online'])
        s.line('[TARGETS] 0');s.line('[FRAME] 2');s.last-=3
        self.assertFalse(s.snapshot()['online'])
if __name__=='__main__':unittest.main()
