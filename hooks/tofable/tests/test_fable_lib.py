#!/usr/bin/env python3
"""Direct unit tests for fable_lib.command_from_input.

Run: python3 hooks/tofable/tests/test_fable_lib.py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fable_lib import command_from_input


class CommandFromInputTests(unittest.TestCase):
    def test_removes_control_characters(self) -> None:
        payload = {"tool_input": {"command": "echo hello\x00\x01world"}}
        self.assertEqual(command_from_input(payload), "echo helloworld")

    def test_does_not_truncate_long_commands(self) -> None:
        command = "echo " + ("x" * 5000)
        payload = {"tool_input": {"command": command}}
        self.assertEqual(command_from_input(payload), command)

    def test_preserves_normal_command_unchanged(self) -> None:
        command = "git status && git diff"
        payload = {"tool_input": {"command": command}}
        self.assertEqual(command_from_input(payload), command)


if __name__ == "__main__":
    unittest.main()
