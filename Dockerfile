FROM node:20-alpine

WORKDIR /app

COPY package.json README.md LICENSE PROMPT.md agent.json ./
COPY bin ./bin
COPY src ./src
COPY docs ./docs
COPY assets ./assets
COPY templates ./templates

EXPOSE 8787

ENTRYPOINT ["node", "/app/bin/agoragentic-premortem-golden-loop.mjs"]
CMD ["doctor", "--repo", "/workspace"]
