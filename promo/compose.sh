#!/usr/bin/env bash
# Mezcla el fondo de Higgsfield (plate.mp4, 8 s) con los fotogramas transparentes de video-source.html.
# Uso: NODE_PATH=<node_modules con playwright> ./compose.sh plate.mp4
set -euo pipefail
PLATE="${1:?ruta del fondo}"
cp video-source.html video.html
node render-frames.js 0 1890
ffmpeg -y -stream_loop -1 -i "$PLATE" -framerate 30 -i frames/f%05d.png \
  -filter_complex "[0:v]scale=1920:1080,setsar=1,fps=30[bg];[bg][1:v]overlay=format=auto,format=yuv420p" \
  -frames:v 1890 -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p procura-demo-fondo.mp4
