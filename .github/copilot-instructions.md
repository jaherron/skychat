# SkyChat - AI Coding Guidelines

## Project Overview
SkyChat is a decentralized chat application built with React 19 and XMTP browser SDK for web3 messaging. The project uses Vite for fast development and TypeScript for type safety.

## Architecture
- **Frontend**: Single-page React application with TypeScript
- **Messaging**: XMTP browser SDK (`@xmtp/browser-sdk`) for decentralized communication
- **Identity**: ATProto integration (`@atproto/api`) for Bluesky identity linking
- **Build Tool**: Vite with HMR and ES modules
- **Type System**: Strict TypeScript with project references (app vs node configs)

## Development Workflow
- **Start dev server**: `npm run dev` (Vite with hot reload)
- **Build**: `npm run build` (TypeScript compilation + Vite build)
- **Lint**: `npm run lint` (ESLint with React-specific rules)
- **Preview**: `npm run preview` (Serve built app)

## Code Conventions
- **TypeScript**: Strict mode enabled with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`
- **ESLint**: Uses `typescript-eslint`, `react-hooks`, and `react-refresh` plugins
- **Imports**: ES modules with `verbatimModuleSyntax` for consistent import/export
- **JSX**: React 19 with automatic JSX transform (`jsx: "react-jsx"`)

## Key Files
- `src/App.tsx`: Main app component with identity linking and chat interface
- `src/main.tsx`: React 18+ root rendering setup
- `vite.config.ts`: Basic Vite config with React plugin
- `tsconfig.app.json`: App-specific TypeScript config (ES2022, DOM types)
- `tsconfig.node.json`: Node tooling config (ES2023)
- `eslint.config.js`: Flat config with React hooks and refresh rules

## XMTP Integration
- Import from `@xmtp/browser-sdk` for messaging functionality
- Browser-based SDK, no server required for basic chat features
- Uses passkey-based identity for secure, wallet-free authentication
- Follow XMTP documentation for conversation and message handling patterns

## ATProto Identity Linking
- Use `@atproto/api` for Bluesky authentication and data repository operations
- Link XMTP inboxes to ATProto DIDs using signed records in `org.xmtp.inbox` collection
- Sign DID with XMTP installation key for verification
- Store association in ATProto PDS and verify signatures using XMTP network

## Dependencies
- **Runtime**: React 19, XMTP browser SDK, ATProto API
- **Dev**: Vite, TypeScript, ESLint with React plugins
- Keep dependencies minimal; prefer built-in browser APIs over additional libraries

## Build Output
- Output goes to `dist/` directory (ignored by ESLint)
- Use `npm run preview` to test production build locally</content>
<parameter name="filePath">/home/jaherron/code/vite/skychat/.github/copilot-instructions.md