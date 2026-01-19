import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';

// ============================================
// Types
// ============================================

interface Response {
  $type: string;
  sourceMessageId: string;
  success: boolean;
  errorInfo?: string;
  data?: any;
  assetURL?: string;
}

interface PendingRequest {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
}

// ============================================
// ResoniteLink Client
// ============================================

class ResoniteLinkClient {
  private ws: WebSocket | null = null;
  private url: string;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private isConnected = false;
  private requestTimeout = 30000;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.isConnected = true;
        console.log(`Connected to ${this.url}`);
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        console.log('Connection closed');
        this.isConnected = false;
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (!this.isConnected) {
          reject(error);
        }
      });
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const response = JSON.parse(data.toString()) as Response;
      const pending = this.pendingRequests.get(response.sourceMessageId);

      if (pending) {
        this.pendingRequests.delete(response.sourceMessageId);
        pending.resolve(response);
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }

  private async sendMessage(message: any): Promise<Response> {
    if (!this.ws || !this.isConnected) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(message.messageId)) {
          this.pendingRequests.delete(message.messageId);
          reject(new Error(`Request timeout: ${message.$type}`));
        }
      }, this.requestTimeout);

      this.pendingRequests.set(message.messageId, {
        resolve: (response: Response) => {
          clearTimeout(timeoutId);
          resolve(response);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });

      this.ws!.send(JSON.stringify(message), (error) => {
        if (error) {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(message.messageId);
          reject(error);
        }
      });
    });
  }

  async importTextureFile(filePath: string): Promise<Response> {
    const message = {
      $type: 'importTexture2DFile',
      messageId: uuidv4(),
      filePath,
    };
    return this.sendMessage(message);
  }

  async addSlot(options: {
    parentId?: string;
    name: string;
    position?: { x: number; y: number; z: number };
    isActive?: boolean;
  }): Promise<Response> {
    const slotData: any = {
      name: { value: options.name },
    };
    if (options.parentId) {
      slotData.parent = { targetId: options.parentId };
    }
    if (options.position) {
      slotData.position = { value: options.position };
    }
    if (options.isActive !== undefined) {
      slotData.isActive = { value: options.isActive };
    }

    const message = {
      $type: 'addSlot',
      messageId: uuidv4(),
      data: slotData,
    };
    return this.sendMessage(message);
  }

  async getSlot(slotId: string, depth = 0, includeComponentData = false): Promise<Response> {
    const message = {
      $type: 'getSlot',
      messageId: uuidv4(),
      slotId,
      depth,
      includeComponentData,
    };
    return this.sendMessage(message);
  }

  async addComponent(containerSlotId: string, componentType: string): Promise<Response> {
    const message = {
      $type: 'addComponent',
      messageId: uuidv4(),
      containerSlotId,
      data: { componentType },
    };
    return this.sendMessage(message);
  }

  async getComponent(componentId: string): Promise<Response> {
    const message = {
      $type: 'getComponent',
      messageId: uuidv4(),
      componentId,
    };
    return this.sendMessage(message);
  }

  async updateComponent(id: string, members: any): Promise<Response> {
    const message = {
      $type: 'updateComponent',
      messageId: uuidv4(),
      data: { id, members },
    };
    return this.sendMessage(message);
  }

  async findSlotByName(name: string, startSlotId = 'Root', depth = 10): Promise<any | null> {
    const response = await this.getSlot(startSlotId, depth, false);
    if (!response.success) return null;
    return this.findSlotByNameRecursive(response.data, name);
  }

  private findSlotByNameRecursive(slot: any, name: string): any | null {
    if (slot.name?.value === name) {
      return slot;
    }
    if (slot.children) {
      for (const child of slot.children) {
        const found = this.findSlotByNameRecursive(child, name);
        if (found) return found;
      }
    }
    return null;
  }
}

// ============================================
// Image Slot Builder
// ============================================

async function spawnImageSlot(
  client: ResoniteLinkClient,
  imageName: string,
  assetURL: string,
  position: { x: number; y: number; z: number }
): Promise<string> {
  console.log(`Spawning image slot: ${imageName}`);

  // 1. Create main slot
  await client.addSlot({
    name: imageName,
    position,
    isActive: true,
  });

  // Find the created slot
  const slot = await client.findSlotByName(imageName, 'Root', 5);
  if (!slot?.id) {
    throw new Error(`Failed to find created slot: ${imageName}`);
  }
  const slotId = slot.id;
  console.log(`Created slot: ${slotId}`);

  // 2. Add Grabbable
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.Grabbable');

  // 3. Add StaticTexture2D
  const staticTextureResp = await client.addComponent(
    slotId,
    '[FrooxEngine]FrooxEngine.StaticTexture2D'
  );

  // Get the slot again to find component IDs
  const slotData = await client.getSlot(slotId, 0, true);
  const components = slotData.data?.components || [];

  const findComponent = (typeIncludes: string) =>
    components.find((c: any) => c.componentType?.includes(typeIncludes));

  const staticTexture = findComponent('StaticTexture2D');
  if (!staticTexture) throw new Error('StaticTexture2D not found');

  // Set the texture URL
  await client.updateComponent(staticTexture.id, {
    URL: { $type: 'Uri', value: assetURL },
  });

  // 4. Add TextureExportable
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.TextureExportable');

  // 5. Add ItemTextureThumbnailSource
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.ItemTextureThumbnailSource');

  // 6. Add SnapPlane
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.SnapPlane');

  // 7. Add ReferenceProxy
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.ReferenceProxy');

  // 8. Add AssetProxy<Texture2D>
  await client.addComponent(
    slotId,
    '[FrooxEngine]FrooxEngine.AssetProxy<[FrooxEngine]FrooxEngine.Texture2D>'
  );

  // 9. Add UnlitMaterial
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.UnlitMaterial');

  // 10. Add QuadMesh
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.QuadMesh');

  // 11. Add MeshRenderer
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.MeshRenderer');

  // 12. Add TextureSizeDriver
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.TextureSizeDriver');

  // 13. Add BoxCollider
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.BoxCollider');

  // 14. Add Float2ToFloat3SwizzleDriver
  await client.addComponent(slotId, '[FrooxEngine]FrooxEngine.Float2ToFloat3SwizzleDriver');

  // Small delay for components to initialize
  await delay(100);

  // Get updated slot data with all components
  const updatedSlot = await client.getSlot(slotId, 0, true);
  const allComponents = updatedSlot.data?.components || [];

  const getComp = (typeIncludes: string) =>
    allComponents.find((c: any) => c.componentType?.includes(typeIncludes));

  const staticTexture2 = getComp('StaticTexture2D');
  const textureExportable = getComp('TextureExportable');
  const thumbnailSource = getComp('ItemTextureThumbnailSource');
  const snapPlane = getComp('SnapPlane');
  const referenceProxy = getComp('ReferenceProxy');
  const assetProxy = getComp('AssetProxy');
  const unlitMaterial = getComp('UnlitMaterial');
  const quadMesh = getComp('QuadMesh');
  const meshRenderer = getComp('MeshRenderer');
  const textureSizeDriver = getComp('TextureSizeDriver');
  const boxCollider = getComp('BoxCollider');
  const swizzleDriver = getComp('Float2ToFloat3SwizzleDriver');

  // Configure TextureExportable
  if (textureExportable && staticTexture2) {
    await client.updateComponent(textureExportable.id, {
      Texture: { $type: 'reference', targetId: staticTexture2.id },
    });
  }

  // Configure ItemTextureThumbnailSource
  if (thumbnailSource && staticTexture2) {
    await client.updateComponent(thumbnailSource.id, {
      Texture: { $type: 'reference', targetId: staticTexture2.id },
    });
  }

  // Configure SnapPlane
  if (snapPlane) {
    await client.updateComponent(snapPlane.id, {
      Normal: { $type: 'float3', value: { x: 0, y: 0, z: 1 } },
    });
  }

  // Configure ReferenceProxy
  if (referenceProxy && staticTexture2) {
    await client.updateComponent(referenceProxy.id, {
      Reference: { $type: 'reference', targetId: staticTexture2.id },
    });
  }

  // Configure AssetProxy
  if (assetProxy && staticTexture2) {
    await client.updateComponent(assetProxy.id, {
      AssetReference: { $type: 'reference', targetId: staticTexture2.id },
    });
  }

  // Configure UnlitMaterial
  if (unlitMaterial && staticTexture2) {
    await client.updateComponent(unlitMaterial.id, {
      Texture: { $type: 'reference', targetId: staticTexture2.id },
      BlendMode: { $type: 'enum', value: 'Alpha', enumType: 'BlendMode' },
      Sidedness: { $type: 'enum', value: 'Double', enumType: 'Sidedness' },
    });
  }

  // Get QuadMesh details for Size field ID
  let quadMeshSizeId: string | null = null;
  if (quadMesh) {
    const quadMeshDetails = await client.getComponent(quadMesh.id);
    quadMeshSizeId = quadMeshDetails.data?.members?.Size?.id;
  }

  // Get BoxCollider details for Size field ID
  let boxColliderSizeId: string | null = null;
  if (boxCollider) {
    const boxColliderDetails = await client.getComponent(boxCollider.id);
    boxColliderSizeId = boxColliderDetails.data?.members?.Size?.id;

    // Configure BoxCollider
    await client.updateComponent(boxCollider.id, {
      Type: { $type: 'enum', value: 'NoCollision', enumType: 'ColliderType' },
    });
  }

  // Configure MeshRenderer - handle empty Materials list
  if (meshRenderer && quadMesh && unlitMaterial) {
    let meshRendererDetails = await client.getComponent(meshRenderer.id);
    let materials = meshRendererDetails.data?.members?.Materials;

    // Set Mesh reference
    await client.updateComponent(meshRenderer.id, {
      Mesh: { $type: 'reference', targetId: quadMesh.id },
    });

    // Check if Materials list is empty - need to add an element first
    if (!materials?.elements || materials.elements.length === 0) {
      // Add a new element to the empty list (creates with null targetId)
      await client.updateComponent(meshRenderer.id, {
        Materials: {
          $type: 'list',
          id: materials.id,
          elements: [{ $type: 'reference', targetId: unlitMaterial.id }],
        },
      });

      // Re-fetch to get the new element's ID
      meshRendererDetails = await client.getComponent(meshRenderer.id);
      materials = meshRendererDetails.data?.members?.Materials;
    }

    // Now update the element with its ID and the target
    const firstMaterialElementId = materials?.elements?.[0]?.id;
    if (firstMaterialElementId) {
      await client.updateComponent(meshRenderer.id, {
        Materials: {
          $type: 'list',
          id: materials.id,
          elements: [{ $type: 'reference', id: firstMaterialElementId, targetId: unlitMaterial.id }],
        },
      });
    }
  }

  // Configure TextureSizeDriver
  if (textureSizeDriver && staticTexture2 && quadMeshSizeId) {
    await client.updateComponent(textureSizeDriver.id, {
      Texture: { $type: 'reference', targetId: staticTexture2.id },
      Target: { $type: 'reference', targetId: quadMeshSizeId },
      DriveMode: { $type: 'enum', value: 'Normalized', enumType: 'Mode' },
    });
  }

  // Configure Float2ToFloat3SwizzleDriver
  if (swizzleDriver && quadMeshSizeId && boxColliderSizeId) {
    await client.updateComponent(swizzleDriver.id, {
      Source: { $type: 'reference', targetId: quadMeshSizeId },
      Target: { $type: 'reference', targetId: boxColliderSizeId },
      X: { $type: 'int', value: 0 },
      Y: { $type: 'int', value: 1 },
      Z: { $type: 'int', value: -1 },
    });
  }

  console.log(`Image slot created: ${imageName} (${slotId})`);
  return slotId;
}

async function updateImageSlot(
  client: ResoniteLinkClient,
  imageName: string,
  assetURL: string
): Promise<boolean> {
  console.log(`Updating image slot: ${imageName}`);

  // Find the existing slot
  const slot = await client.findSlotByName(imageName, 'Root', 10);
  if (!slot?.id) {
    console.log(`Slot not found for update: ${imageName}`);
    return false;
  }

  // Get slot components
  const slotData = await client.getSlot(slot.id, 0, true);
  const components = slotData.data?.components || [];

  const staticTexture = components.find((c: any) =>
    c.componentType?.includes('StaticTexture2D')
  );

  if (!staticTexture) {
    console.log(`StaticTexture2D not found in slot: ${imageName}`);
    return false;
  }

  // Update the texture URL
  await client.updateComponent(staticTexture.id, {
    URL: { $type: 'Uri', value: assetURL },
  });

  console.log(`Image updated: ${imageName}`);
  return true;
}

// ============================================
// File Watcher
// ============================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

async function main() {
  const wsUrl = process.argv[2] || 'ws://localhost:22345';
  const watchDir = process.argv[3] || path.join(process.cwd(), 'images');

  console.log('ImageLink - Resonite Image Sync');
  console.log('================================');
  console.log(`WebSocket URL: ${wsUrl}`);
  console.log(`Watch directory: ${watchDir}`);

  // Ensure images directory exists
  if (!fs.existsSync(watchDir)) {
    fs.mkdirSync(watchDir, { recursive: true });
    console.log(`Created watch directory: ${watchDir}`);
  }

  // Connect to Resonite
  const client = new ResoniteLinkClient(wsUrl);

  try {
    await client.connect();
  } catch (error) {
    console.error('Failed to connect to Resonite:', error);
    process.exit(1);
  }

  // Track known images to detect add vs update
  const knownImages = new Set<string>();

  // Spawn position counter
  let spawnIndex = 0;
  const getSpawnPosition = () => {
    const x = (spawnIndex % 5) * 0.5;
    const y = 1.5 + Math.floor(spawnIndex / 5) * 0.5;
    spawnIndex++;
    return { x, y: y, z: 1.5 };
  };

  // Initialize watcher
  const watcher = chokidar.watch(watchDir, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on('add', async (filePath) => {
    if (!isImageFile(filePath)) return;

    const fileName = path.basename(filePath);
    const absolutePath = path.resolve(filePath);

    console.log(`\nFile detected: ${fileName}`);

    try {
      // Upload texture first
      console.log('Uploading texture...');
      const importResult = await client.importTextureFile(absolutePath);

      if (!importResult.success || !importResult.assetURL) {
        console.error('Failed to import texture:', importResult.errorInfo);
        return;
      }

      console.log(`Texture uploaded: ${importResult.assetURL}`);

      if (knownImages.has(fileName)) {
        // Update existing
        await updateImageSlot(client, fileName, importResult.assetURL);
      } else {
        // Spawn new
        knownImages.add(fileName);
        await spawnImageSlot(client, fileName, importResult.assetURL, getSpawnPosition());
      }
    } catch (error) {
      console.error(`Error processing ${fileName}:`, error);
    }
  });

  watcher.on('change', async (filePath) => {
    if (!isImageFile(filePath)) return;

    const fileName = path.basename(filePath);
    const absolutePath = path.resolve(filePath);

    console.log(`\nFile changed: ${fileName}`);

    try {
      // Upload new texture
      console.log('Uploading new texture...');
      const importResult = await client.importTextureFile(absolutePath);

      if (!importResult.success || !importResult.assetURL) {
        console.error('Failed to import texture:', importResult.errorInfo);
        return;
      }

      console.log(`Texture uploaded: ${importResult.assetURL}`);

      // Try to update existing slot
      const updated = await updateImageSlot(client, fileName, importResult.assetURL);

      if (!updated) {
        // Slot doesn't exist, create it
        knownImages.add(fileName);
        await spawnImageSlot(client, fileName, importResult.assetURL, getSpawnPosition());
      }
    } catch (error) {
      console.error(`Error updating ${fileName}:`, error);
    }
  });

  watcher.on('ready', () => {
    console.log('\nWatching for image changes...');
    console.log('Press Ctrl+C to stop\n');
  });

  watcher.on('error', (error) => {
    console.error('Watcher error:', error);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    watcher.close();
    client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
