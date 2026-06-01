import json
import tempfile
import unittest
from pathlib import Path

from stage_enac.pipeline import parse_log_line, run_pipeline


class PipelineTests(unittest.TestCase):
    def test_parse_log_line_accepts_pipe_separator(self) -> None:
        parsed = parse_log_line("2026-01-01T10:00:00Z|AFR123|SOL|BORD|REQUEST|CLIMB FL350")
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.flight_id, "AFR123")
        self.assertEqual(parsed.message_type, "REQUEST")

    def test_run_pipeline_creates_expected_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            input_file = base / "sample.log"
            output_dir = base / "out"
            input_file.write_text(
                "\n".join(
                    [
                        "2026-01-01T10:00:00Z|AFR123|SOL|BORD|REQUEST|CLIMB FL350",
                        "2026-01-01T10:00:05Z|AFR123|BORD|SOL|WILCO|ROGER",
                        "2026-01-01T10:02:00Z|AFR456|SOL|BORD|REQUEST|DESCEND FL240",
                    ]
                ),
                encoding="utf-8",
            )

            run_pipeline(input_file=input_file, output_dir=output_dir)

            self.assertTrue((output_dir / "summary.json").exists())
            self.assertTrue((output_dir / "cases_typiques.json").exists())
            self.assertTrue((output_dir / "difference_theorie_realite.json").exists())
            self.assertTrue((output_dir / "chronogramme.csv").exists())
            self.assertTrue((output_dir / "diagramme_sequence.puml").exists())

            summary = json.loads((output_dir / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["messages_total"], 3)

            reality_gap = json.loads((output_dir / "difference_theorie_realite.json").read_text(encoding="utf-8"))
            self.assertEqual(reality_gap["unanswered_requests"], 1)


if __name__ == "__main__":
    unittest.main()

