# Scoreplay Studio

A full-stack sheet-music player. Import MusicXML or MXL directly, or upload a printed-score PDF for local optical music recognition. View the engraved notation, listen to all score parts with a sampled grand piano, change tempo and transpose the written score.

## Run the complete app

Install Docker Desktop, then from this repository folder run:

```sh
docker compose up --build
```

Open [http://localhost:8000](http://localhost:8000). The first build downloads the web dependencies and Audiveris. PDF recognition runs in the local container with Audiveris and Ghostscript. The browser fetches the piano samples on first playback from the Tone.js Salamander sample set, so an internet connection is needed for the piano sound.

To stop the app, press Ctrl+C. Remove the container with `docker compose down`.

## Local development

You need Node 22+, Python 3.11+, Ghostscript, and Audiveris 5.11 or later available on `PATH`.

```sh
npm install
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload --port 8000
```

In another terminal:

```sh
npm run dev
```

Vite runs at [http://localhost:5173](http://localhost:5173) and proxies API requests to FastAPI at port 8000.

## What it reads

- **PDF:** Audiveris recognizes printed sheet notation and exports MusicXML. The recognized score is then engraved in the page and used for playback. Clean, high-resolution prints work best; optical recognition can misread notes, so review the result.
- **MusicXML (`.xml`, `.musicxml`):** imported and engraved directly.
- **Compressed MusicXML (`.mxl`):** unpacked on the server and imported.

Handwritten notation is not supported. PDF and MusicXML are limited to 20 MB per upload. Tempo and pitch controls update playback, and transposition also updates the displayed score.

## Privacy

With the included Docker setup, uploads are sent to the local app at `127.0.0.1` and processed locally. If you deploy the site to a public server, uploaded PDFs will be sent to that server; configure storage and retention to suit your use before exposing it publicly. The piano audio samples are fetched from Tone.js when playback starts.

## Built with

- React, Vite, TypeScript
- OpenSheetMusicDisplay for MusicXML engraving
- Tone.js and the Salamander sampled grand piano
- FastAPI, Audiveris, Ghostscript

Audiveris may need additional review/correction for dense or low-quality scans. Its MusicXML export is an OMR interpretation, not a guarantee of error-free transcription.
