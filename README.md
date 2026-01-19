# ImageLink

A file watcher that automatically syncs images from a local directory into Resonite. When you add or update an image file, it gets uploaded and spawned as a fully interactive image object in your Resonite world.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Resonite](https://resonite.com/) with [ResoniteLink](https://github.com/YourRepo/ResoniteLink) mod installed and running
- ResoniteLink WebSocket server active (default: `ws://localhost:22345`)

## Setup

1. **Install dependencies:**

   ```bash
   cd imagelink
   npm install
   ```

2. **Build the project (optional, for production):**

   ```bash
   npm run build
   ```

3. **Ensure ResoniteLink is running in Resonite:**
   - The WebSocket server should be listening (default port: 22345)
   - You should be in a world where you have edit permissions

## Usage

### Development Mode (recommended)

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

### Custom Configuration

You can specify a custom WebSocket URL and watch directory:

```bash
# Using tsx (dev)
npx tsx src/index.ts [websocket-url] [watch-directory]

# Using compiled version
node dist/index.js [websocket-url] [watch-directory]
```

**Examples:**

```bash
# Default settings (ws://localhost:22345, ./images)
npm run dev

# Custom WebSocket URL
npx tsx src/index.ts ws://localhost:29551

# Custom WebSocket URL and watch directory
npx tsx src/index.ts ws://localhost:22345 C:/Users/me/Pictures/resonite
```

## How It Works

### Adding New Images

1. Drop an image file into the `images/` directory
2. ImageLink detects the new file
3. The texture is uploaded to Resonite
4. A complete image slot is spawned with all standard components:
   - **Grabbable** - Makes the image interactive
   - **StaticTexture2D** - Holds the uploaded texture
   - **UnlitMaterial** - Renders the texture with alpha transparency
   - **QuadMesh** - Display surface
   - **MeshRenderer** - Renders the mesh with material
   - **TextureSizeDriver** - Auto-sizes the quad to match texture aspect ratio
   - **BoxCollider** - Interaction bounds
   - And more (TextureExportable, SnapPlane, etc.)

### Updating Existing Images

1. Modify or replace an existing image file in the `images/` directory
2. ImageLink detects the change
3. The new texture is uploaded
4. The existing slot's texture URL is updated (no duplicate slots created)

## Supported Formats

- PNG (`.png`)
- JPEG (`.jpg`, `.jpeg`)
- GIF (`.gif`)
- BMP (`.bmp`)
- WebP (`.webp`)

## Spawn Behavior

Images spawn in a grid pattern:
- Starting position: `x=0, y=1.5, z=1.5`
- Horizontal spacing: 0.5 units
- 5 images per row before wrapping to next row

## Troubleshooting

### "Failed to connect to Resonite"

- Ensure Resonite is running with the ResoniteLink mod
- Check that the WebSocket URL is correct
- Verify the port isn't blocked by a firewall

### Images appear black or transparent

- This was a known issue that has been fixed
- Ensure you're using the latest version of ImageLink
- Try deleting the slot in Resonite and re-adding the image

### Images not detecting

- Ensure the file has a supported extension
- Check that the watch directory path is correct
- The watcher waits for files to finish writing before processing

## Project Structure

```
imagelink/
├── src/
│   └── index.ts      # Main application
├── images/           # Default watch directory (gitignored)
├── dist/             # Compiled output (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
