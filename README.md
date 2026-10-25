# Earthquake Explorer — Task 5

Captured map bounds. React and Node.js use TypeScript with pnpm.

## Run

Requires Node.js 24 and pnpm 10.20.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:5173. The USGS API proxy listens on port 3001.

## Verify

```sh
pnpm typecheck
pnpm test:server
pnpm test:web
pnpm build
```

This reconstructed checkpoint adds the task named above; later commits complete the remaining dashboard flow.
