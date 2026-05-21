#!/usr/bin/env python3
"""
Generate a PDF transcript for a YouTube video.

Usage:
    python3 transcribe.py <youtube_url> <output_pdf_path>

Exit codes:
    0  success
    2  bad CLI usage
    3  could not extract a video ID from the URL
    4  transcripts are disabled for that video
    5  no transcript available
    6  video unavailable
    7  unexpected transcript-fetch error
    8  PDF-build error

How it stays free:
  - YouTube oEmbed (https://www.youtube.com/oembed) for title/author. No API key.
  - youtube-transcript-api for the transcript itself. Uses YouTube's own
    captions (manual or auto-generated). No API key.
  - reportlab to write the PDF locally.

Install dependencies once on the Droplet:
    pip3 install -r requirements.txt
"""

import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import (
        TranscriptsDisabled,
        NoTranscriptFound,
        VideoUnavailable,
    )
except ImportError:
    print(
        "Missing dependency: youtube-transcript-api.\n"
        "Install with:  pip3 install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        HRFlowable,
    )
except ImportError:
    print(
        "Missing dependency: reportlab.\n"
        "Install with:  pip3 install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(1)


VIDEO_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|embed/|v/|shorts/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})"
)


def extract_video_id(url: str) -> str:
    m = VIDEO_ID_RE.search(url)
    if not m:
        raise ValueError(f"Could not extract a video ID from URL: {url}")
    return m.group(1)


def fetch_video_meta(url: str) -> dict:
    """Public oEmbed endpoint — no API key needed."""
    endpoint = "https://www.youtube.com/oembed?" + urllib.parse.urlencode(
        {"url": url, "format": "json"}
    )
    try:
        with urllib.request.urlopen(endpoint, timeout=15) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return {}


def fetch_transcript(video_id: str) -> list:
    """Return [{text, start, duration}, ...]; English preferred."""
    try:
        return YouTubeTranscriptApi.get_transcript(
            video_id, languages=["en", "en-US", "en-GB"]
        )
    except NoTranscriptFound:
        pass

    # Fall back: take any available language, translate to English when possible.
    transcripts = YouTubeTranscriptApi.list_transcripts(video_id)
    for t in transcripts:
        try:
            if t.is_translatable:
                return t.translate("en").fetch()
            return t.fetch()
        except Exception:
            continue
    raise NoTranscriptFound(video_id, ["en"], None)


def fmt_timestamp(seconds: float) -> str:
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:d}:{m:02d}:{s:02d}"
    return f"{m:d}:{s:02d}"


def xml_escape(text: str) -> str:
    """Escape characters that would break reportlab Paragraph markup."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def build_pdf(output_path: str, url: str, meta: dict, transcript: list) -> None:
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        title=meta.get("title", "YouTube Transcript"),
        author="Video2Text",
    )
    styles = getSampleStyleSheet()
    primary = colors.HexColor("#a30001")
    muted = colors.HexColor("#666666")
    body_color = colors.HexColor("#111111")
    divider = colors.HexColor("#e0dcd5")

    title_style = ParagraphStyle(
        "VT_Title",
        parent=styles["Title"],
        fontSize=20,
        leading=24,
        textColor=primary,
        spaceAfter=8,
        alignment=0,
    )
    meta_style = ParagraphStyle(
        "VT_Meta",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        textColor=muted,
        spaceAfter=3,
    )
    ts_style = ParagraphStyle(
        "VT_Ts",
        parent=styles["Normal"],
        fontSize=8,
        leading=12,
        textColor=primary,
        spaceAfter=2,
        fontName="Courier-Bold",
    )
    body_style = ParagraphStyle(
        "VT_Body",
        parent=styles["BodyText"],
        fontSize=11,
        leading=16,
        textColor=body_color,
        spaceAfter=10,
    )

    story = []
    title = meta.get("title") or "YouTube Transcript"
    author = meta.get("author_name", "")
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    story.append(Paragraph(xml_escape(title), title_style))
    if author:
        story.append(Paragraph(f"By <b>{xml_escape(author)}</b>", meta_style))
    story.append(
        Paragraph(
            f'Source: <a href="{xml_escape(url)}" color="#a30001">{xml_escape(url)}</a>',
            meta_style,
        )
    )
    story.append(Paragraph(f"Generated: {now_utc}", meta_style))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", color=divider, thickness=0.8))
    story.append(Spacer(1, 14))

    if not transcript:
        story.append(Paragraph("No transcript text was available.", body_style))
    else:
        # Group transcript into ~30s buckets so paragraphs are readable.
        BUCKET_SECONDS = 30
        bucket_text = []
        bucket_start = None
        for entry in transcript:
            start = float(entry.get("start", 0.0))
            text = (entry.get("text") or "").strip().replace("\n", " ")
            if not text:
                continue
            if bucket_start is None:
                bucket_start = start
            if start - bucket_start >= BUCKET_SECONDS and bucket_text:
                story.append(Paragraph(fmt_timestamp(bucket_start), ts_style))
                story.append(Paragraph(xml_escape(" ".join(bucket_text)), body_style))
                bucket_text = []
                bucket_start = start
            bucket_text.append(text)
        if bucket_text:
            story.append(Paragraph(fmt_timestamp(bucket_start), ts_style))
            story.append(Paragraph(xml_escape(" ".join(bucket_text)), body_style))

    doc.build(story)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: transcribe.py <youtube_url> <output_pdf_path>", file=sys.stderr)
        return 2

    url = sys.argv[1]
    output_path = sys.argv[2]

    try:
        video_id = extract_video_id(url)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 3

    meta = fetch_video_meta(url)

    try:
        transcript = fetch_transcript(video_id)
    except TranscriptsDisabled:
        print(f"Transcripts are disabled for video {video_id}.", file=sys.stderr)
        return 4
    except NoTranscriptFound:
        print(f"No transcript found for video {video_id}.", file=sys.stderr)
        return 5
    except VideoUnavailable:
        print(f"Video {video_id} is unavailable.", file=sys.stderr)
        return 6
    except Exception as e:
        print(f"Failed to fetch transcript: {e}", file=sys.stderr)
        return 7

    try:
        build_pdf(output_path, url, meta, transcript)
    except Exception as e:
        print(f"Failed to build PDF: {e}", file=sys.stderr)
        return 8

    return 0


if __name__ == "__main__":
    sys.exit(main())
