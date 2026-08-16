#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path


def dump(value):
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        return dump(value.model_dump(mode="json"))
    if hasattr(value, "export_to_dict"):
        return dump(value.export_to_dict())
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(key): dump(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [dump(item) for item in value]
    if isinstance(value, (str, int, bool)):
        return value
    return str(value)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: docling_bridge.py INPUT OUTPUT")
    from docling.document_converter import DocumentConverter
    from docling_core.types.doc import ImageRefMode

    source, output = sys.argv[1], Path(sys.argv[2])
    result = DocumentConverter().convert(source)
    payload = {
        "status": str(getattr(result, "status", "success")),
        "document": dump(result.document),
        "markdown": result.document.export_to_markdown(image_mode=ImageRefMode.PLACEHOLDER),
        "confidence": dump(getattr(result, "confidence", None)),
        "errors": [dump(item) for item in getattr(result, "errors", [])],
        "pages": len(getattr(result, "pages", []) or []),
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")


if __name__ == "__main__":
    main()
