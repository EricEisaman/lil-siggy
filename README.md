# Sigma Agent

A browser-native agentic web app running **SmolLM-1.7B-Instruct** using **Transformers.js** with a **WASM** backend. It features a **Ralph-inspired loop** for agentic tool calling (Observe -> Think -> Act -> Observe).

## Features
- **100% Client-side**: No backend server required for inference.
- **Ralph Loop**: Structured reasoning with `<think>` blocks and JSON tool calls.
- **Built-in Tools**: 
  - `calculator`: Solve math expressions.
  - `weather`: Mock weather data for any city.
- **Premium UI**: Modern Tailwind CSS interface with glassmorphism effects.
- **Render.com Ready**: Optimized Docker + Nginx configuration.

## Development

```bash
# Install dependencies
npm install

# Run local development server
npm run dev

# Build for production
npm run build
```

## Deployment on Render.com

1. Create a new **Web Service** on Render.
2. Connect your repository.
3. Render will automatically detect the `render.yaml` file.
4. Set Environment to **Docker**.

## Technical Details
- **Architecture**: Web Worker for off-main-thread inference to keep the UI responsive.
- **Model**: `Xenova/SmolLM-1.7B-Instruct` (Quantized Q4 for performance).
- **Backend**: ONNX Runtime Web (WASM).

## License
MIT
