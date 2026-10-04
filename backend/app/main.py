from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

MAX_UPLOAD = 20 * 1024 * 1024
TIMEOUT_SECONDS = 300
ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
app = FastAPI(title="Scoreplay Studio API", version="1.0.0")


def find_audiveris() -> str | None:
    configured = os.getenv("AUDIVERIS_BIN")
    if configured and Path(configured).is_file():
        return configured
    return shutil.which("audiveris") or ("/opt/audiveris/bin/Audiveris" if Path("/opt/audiveris/bin/Audiveris").is_file() else None)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def validate_musicxml(xml: str) -> str:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise HTTPException(status_code=422, detail="The converted score was not valid MusicXML.") from exc
    if local_name(root.tag) not in {"score-partwise", "score-timewise"}:
        raise HTTPException(status_code=422, detail="The upload did not contain a MusicXML score.")
    return xml


def read_mxl(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.namelist()
            container = next((entry for entry in entries if entry.lower() == "meta-inf/container.xml"), None)
            if container:
                root = ET.fromstring(archive.read(container))
                for item in root.iter():
                    if local_name(item.tag) == "rootfile":
                        target = item.attrib.get("full-path", "")
                        if target in entries:
                            return archive.read(target).decode("utf-8-sig")
            candidate = next((entry for entry in entries if entry.lower().endswith(".xml") and not entry.lower().startswith("meta-inf/")), None)
            if candidate:
                return archive.read(candidate).decode("utf-8-sig")
    except (zipfile.BadZipFile, UnicodeDecodeError, ET.ParseError) as exc:
        raise HTTPException(status_code=422, detail="That compressed MusicXML file could not be opened.") from exc
    raise HTTPException(status_code=422, detail="No score XML was found inside this MXL file.")


@app.get("/api/health")
def health():
    recognizer = find_audiveris()
    return {"ok": True, "omrReady": bool(recognizer and shutil.which("gs")), "recognizer": "Audiveris" if recognizer else None}


@app.post("/api/recognize")
async def recognize(file: UploadFile = File(...)):
    filename = Path(file.filename or "score").name
    suffix = Path(filename).suffix.lower()
    content = await file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="Choose a score smaller than 20 MB.")
    if suffix in {".xml", ".musicxml"}:
        return {"musicxml": validate_musicxml(content.decode("utf-8-sig"))}
    if suffix == ".mxl":
        with tempfile.TemporaryDirectory(prefix="scoreplay-xml-") as folder:
            compressed = Path(folder) / "score.mxl"
            compressed.write_bytes(content)
            return {"musicxml": validate_musicxml(read_mxl(compressed))}
    if suffix != ".pdf" or not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="Upload a PDF, MusicXML, or MXL score.")

    audiveris = find_audiveris()
    if not audiveris:
        raise HTTPException(status_code=503, detail="The score reader is unavailable. Start the Docker app with its included Audiveris service.")
    if not shutil.which("gs"):
        raise HTTPException(status_code=503, detail="Ghostscript is needed to read this PDF.")

    with tempfile.TemporaryDirectory(prefix="scoreplay-omr-") as folder:
        work = Path(folder)
        source = work / "score.pdf"
        output = work / "recognized"
        output.mkdir()
        source.write_bytes(content)
        command = [audiveris, "-batch", "-transcribe", "-export", "-output", str(output), "--", str(source)]
        try:
            result = await __import__("asyncio").to_thread(
                subprocess.run, command, capture_output=True, text=True, check=False, timeout=TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=408, detail="Score recognition timed out. Try fewer pages or a smaller PDF.") from exc
        exports = sorted([*output.rglob("*.mxl"), *output.rglob("*.xml")])
        if result.returncode != 0 or not exports:
            detail = (result.stderr or result.stdout or "No MusicXML export was produced.").strip()[-800:]
            raise HTTPException(status_code=422, detail=f"The score reader could not recognize this PDF. Clear, printed scores work best. {detail}")
        recognized = validate_musicxml(read_mxl(exports[0]) if exports[0].suffix.lower() == ".mxl" else exports[0].read_text(encoding="utf-8-sig"))
        return {"musicxml": recognized}


if DIST.exists():
    assets = DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        candidate = (DIST / path).resolve()
        if candidate.is_relative_to(DIST.resolve()) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
