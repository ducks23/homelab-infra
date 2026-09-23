# syntax=docker/dockerfile:1

# Build on the host's native platform and cross-compile, so building an amd64
# image for the k3s nodes on an Apple Silicon Mac doesn't run under emulation.
FROM --platform=$BUILDPLATFORM golang:1.25 AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
EXPOSE 8080
# Numeric so Kubernetes' runAsNonRoot check can verify it (65532 = distroless "nonroot").
USER 65532:65532
ENTRYPOINT ["/server"]
