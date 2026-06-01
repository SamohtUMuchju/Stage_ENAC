from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class LogMessage:
    timestamp: datetime
    flight_id: str
    source: str
    destination: str
    message_type: str
    content: str


def parse_log_line(line: str) -> LogMessage | None:
    raw = line.strip()
    if not raw or raw.startswith("#"):
        return None
    separator = "|" if "|" in raw else ";"
    parts = [part.strip() for part in raw.split(separator, maxsplit=5)]
    if len(parts) != 6:
        raise ValueError(f"Ligne de log invalide: {line.rstrip()}")
    timestamp = datetime.fromisoformat(parts[0].replace("Z", "+00:00"))
    return LogMessage(
        timestamp=timestamp,
        flight_id=parts[1],
        source=parts[2],
        destination=parts[3],
        message_type=parts[4],
        content=parts[5],
    )


def parse_log_file(path: Path) -> list[LogMessage]:
    messages: list[LogMessage] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parsed = parse_log_line(line)
        if parsed:
            messages.append(parsed)
    return sorted(messages, key=lambda msg: msg.timestamp)


def build_typical_cases(messages: list[LogMessage]) -> list[dict[str, object]]:
    counts = Counter((msg.source, msg.destination, msg.message_type) for msg in messages)
    return [
        {
            "source": source,
            "destination": destination,
            "message_type": message_type,
            "occurrences": occurrence,
        }
        for (source, destination, message_type), occurrence in counts.most_common()
    ]


def build_reality_gap(messages: list[LogMessage]) -> dict[str, int]:
    request_like = {"REQUEST", "CPDLC_REQUEST"}
    response_like = {"ACK", "WILCO", "UNABLE", "CPDLC_RESPONSE"}
    by_flight: dict[str, list[LogMessage]] = {}
    for msg in messages:
        by_flight.setdefault(msg.flight_id, []).append(msg)

    unanswered_requests = 0
    standalone_responses = 0
    for flight_messages in by_flight.values():
        pending = 0
        for msg in flight_messages:
            msg_type = msg.message_type.upper()
            if msg_type in request_like:
                pending += 1
            elif msg_type in response_like:
                if pending > 0:
                    pending -= 1
                else:
                    standalone_responses += 1
        unanswered_requests += pending
    return {
        "unanswered_requests": unanswered_requests,
        "standalone_responses": standalone_responses,
    }


def write_chronogram(messages: list[LogMessage], output_path: Path) -> None:
    if not messages:
        output_path.write_text("delta_s,timestamp,flight_id,source,destination,message_type,content\n", encoding="utf-8")
        return
    start = messages[0].timestamp
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["delta_s", "timestamp", "flight_id", "source", "destination", "message_type", "content"])
        for msg in messages:
            writer.writerow(
                [
                    int((msg.timestamp - start).total_seconds()),
                    msg.timestamp.isoformat(),
                    msg.flight_id,
                    msg.source,
                    msg.destination,
                    msg.message_type,
                    msg.content,
                ]
            )


def write_sequence_diagram(messages: list[LogMessage], output_path: Path) -> None:
    participants = sorted({msg.source for msg in messages} | {msg.destination for msg in messages})
    lines = ["@startuml", "title Chronologie des échanges Datalink (VDL2)"]
    for participant in participants:
        lines.append(f'participant "{participant}" as {participant.replace("-", "_")}')
    for msg in messages:
        source = msg.source.replace("-", "_")
        destination = msg.destination.replace("-", "_")
        label = f"{msg.timestamp.isoformat()} | {msg.flight_id} | {msg.message_type}: {msg.content}"
        lines.append(f"{source} -> {destination}: {label}")
    lines.append("@enduml")
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_pipeline(input_file: Path, output_dir: Path) -> None:
    messages = parse_log_file(input_file)
    output_dir.mkdir(parents=True, exist_ok=True)

    summary = {
        "messages_total": len(messages),
        "flights": sorted({msg.flight_id for msg in messages}),
        "message_type_counts": dict(Counter(msg.message_type for msg in messages)),
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    typical_cases = build_typical_cases(messages)
    (output_dir / "cases_typiques.json").write_text(
        json.dumps(typical_cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    reality_gap = build_reality_gap(messages)
    (output_dir / "difference_theorie_realite.json").write_text(
        json.dumps(reality_gap, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    write_chronogram(messages, output_dir / "chronogramme.csv")
    write_sequence_diagram(messages, output_dir / "diagramme_sequence.puml")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Analyse des logs VDL mode 2 et génération de sorties pédagogiques."
    )
    parser.add_argument("--input", required=True, type=Path, help="Fichier log source")
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Dossier de sortie (chronogramme, diagramme PlantUML, synthèse JSON)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    run_pipeline(args.input, args.output_dir)
    return 0

