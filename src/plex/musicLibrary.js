import { config } from '../config/index.js';

export function toLocalPath(plexPath) {
  const { plexPathPrefix, localMountPath } = config.musicLibrary;
  if (!plexPath.startsWith(plexPathPrefix)) {
    throw new Error(`Unexpected path prefix (expected "${plexPathPrefix}"): ${plexPath}`);
  }
  return localMountPath + plexPath.slice(plexPathPrefix.length);
}
