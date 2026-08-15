from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from packages.eval_engine.contracts import EvalSample, InferenceResult, ParsedAnswer


def _normalize(text: str, operations: list[str]) -> str:
    value = text
    for operation in operations:
        if operation == "trim":
            value = value.strip()
        elif operation == "unicode_nfkc":
            value = unicodedata.normalize("NFKC", value)
        elif operation == "lowercase":
            value = value.lower()
        else:
            raise ValueError(f"Unknown normalization operation: {operation}")
    return value


@dataclass(frozen=True)
class BuiltinParser:
    config: dict[str, Any]

    @property
    def version(self) -> str:
        return str(self.config.get("version", "1"))

    def parse(self, sample: EvalSample, result: InferenceResult) -> ParsedAnswer:
        del sample
        if result.error_type:
            return ParsedAnswer(
                None,
                "upstream_error",
                self.version,
                {"error_type": result.error_type},
            )
        text = result.output_text
        if text is None or not text.strip():
            return ParsedAnswer(None, "no_match", self.version, {"raw": text})

        parser_type = self.config["type"]
        if parser_type == "label_set":
            operations = self.config.get("normalize", ["trim"])
            normalized = _normalize(text, operations)
            labels = {_normalize(str(label), operations): label for label in self.config["labels"]}
            if normalized in labels:
                return ParsedAnswer(
                    labels[normalized],
                    "ok",
                    self.version,
                    {"normalized": normalized},
                )
            return ParsedAnswer(None, "no_match", self.version, {"normalized": normalized})

        if parser_type == "choice_letter":
            allowed = {
                str(item).upper() for item in self.config.get("allowed", ["A", "B", "C", "D"])
            }
            normalized_text = unicodedata.normalize("NFKC", text)
            matches = re.finditer(r"(?<![A-Za-z])([A-Za-z])(?![A-Za-z])", normalized_text)
            for match in matches:
                value = match.group(1).upper()
                if value in allowed:
                    return ParsedAnswer(
                        value,
                        "ok",
                        self.version,
                        {"span": list(match.span(1))},
                    )
            return ParsedAnswer(None, "no_match", self.version, {})

        if parser_type == "exact_text":
            normalized = _normalize(text, self.config.get("normalize", ["trim", "unicode_nfkc"]))
            return ParsedAnswer(normalized, "ok", self.version, {"normalized": normalized})

        if parser_type == "numeric":
            matches = list(
                re.finditer(
                    r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?",
                    text.replace(",", ""),
                )
            )
            if not matches:
                return ParsedAnswer(None, "no_match", self.version, {})
            selection = self.config.get("selection", "first")
            if selection not in {"first", "last"}:
                raise ValueError(f"Unsupported numeric selection: {selection}")
            match = matches[-1] if selection == "last" else matches[0]
            try:
                value = Decimal(match.group(0))
            except InvalidOperation:
                return ParsedAnswer(None, "invalid_format", self.version, {})
            return ParsedAnswer(str(value), "ok", self.version, {"span": list(match.span())})

        if parser_type == "json_path":
            try:
                value: Any = json.loads(text)
                for part in self.config["path"].strip("$.").split("."):
                    value = value[part]
            except (json.JSONDecodeError, KeyError, TypeError):
                return ParsedAnswer(None, "invalid_format", self.version, {})
            return ParsedAnswer(value, "ok", self.version, {})

        raise ValueError(f"Unsupported parser type: {parser_type}")


def create_parser(config: dict[str, Any]) -> BuiltinParser:
    supported = {"label_set", "choice_letter", "exact_text", "numeric", "json_path"}
    if config.get("type") not in supported:
        raise ValueError(f"Unsupported parser type: {config.get('type')}")
    return BuiltinParser(config=config)
