# LeScout sandbox — isolated environment for ingesting untrusted repos & URLs.
# Foreign code never executes here either: only read-only inspection tools.
FROM alpine:3.20

RUN apk add --no-cache \
      git \
      tree \
      ripgrep \
      jq \
      curl \
      ca-certificates \
      file \
    && adduser -D -u 1000 scout \
    && mkdir -p /scripts /work /out \
    && chown -R scout:scout /scripts /work /out

COPY --chown=scout:scout scripts/ /scripts/
RUN chmod +x /scripts/*.sh

USER scout
WORKDIR /work

# Default entrypoint is the repo scout — override for url/pdf/yt later.
ENTRYPOINT ["/scripts/scout-repo.sh"]
