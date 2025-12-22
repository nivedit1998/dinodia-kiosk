import type { UIDevice } from '../models/device';
import type { HaMode } from '../api/dinodia';
import type { HaConnection } from '../models/haConnection';
import { sendCloudDeviceCommand } from '../api/deviceControl';
import { handleDeviceCommand } from '../utils/haCommands';
import type { DeviceCommandId } from '../capabilities/deviceCapabilities';

type ExecuteParams = {
  haMode: HaMode;
  connection: HaConnection | null;
  device: UIDevice;
  command: DeviceCommandId | string;
  value?: number;
};

export async function executeDeviceCommand(params: ExecuteParams): Promise<void> {
  const { haMode, connection, device, command, value } = params;

  if (haMode === 'cloud') {
    try {
      await sendCloudDeviceCommand({
        entityId: device.entityId,
        command,
        value,
      });
      return;
    } catch (err: any) {
      const msg = (err instanceof Error && err.message) || '';
      const canFallback =
        connection?.cloudUrl && typeof connection.cloudUrl === 'string' && connection.longLivedToken;
      const isSessionError = msg.toLowerCase().includes('session has ended');
      if (canFallback && isSessionError) {
        await handleDeviceCommand(
          {
            ha: {
              baseUrl: connection.cloudUrl!.replace(/\/+$/, ''),
              longLivedToken: connection.longLivedToken,
            },
            entityId: device.entityId,
            command,
            value,
            blindTravelSeconds: device.blindTravelSeconds ?? null,
          },
          true
        );
        return;
      }
      throw err;
    }
  }

  const baseUrl = (connection?.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!connection || !baseUrl) {
    throw new Error(
      'We cannot find your Dinodia Hub on the home Wi-Fi. Switch to Dinodia Cloud to control your place.'
    );
  }

  await handleDeviceCommand({
    ha: {
      baseUrl,
      longLivedToken: connection.longLivedToken,
    },
    entityId: device.entityId,
    command,
    value,
    blindTravelSeconds: device.blindTravelSeconds ?? null,
  });
}
