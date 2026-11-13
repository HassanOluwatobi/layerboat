#!/bin/sh
# builds the relay for Mac (Apple silicon and Intel) and Windows
set -e
cd "$(dirname "$0")"
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o layerboat-helper-arm64 .
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o layerboat-helper-amd64 .
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o layerboat-helper-windows-amd64.exe .
CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o layerboat-helper-windows-arm64.exe .
