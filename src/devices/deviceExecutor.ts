import type { UIDevice } from '../models/device';
import type { HaMode } from '../api/dinodia';
import type { HaConnection } from '../models/haConnection';
import { sendCloudDeviceCommand } from '../api/deviceControl';
import { handleDeviceCommand } from '../utils/haCommands';
import type { DeviceCommandId } from '../capabilities/deviceCapabilities';
import { fetchHomeModeSecrets } from '../api/haSecrets';

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
      throw err;
    }
  }

  const homeSecrets = await fetchHomeModeSecrets().catch(() => null);
  const baseUrl = homeSecrets?.baseUrl ?? '';
  const token = homeSecrets?.longLivedToken;

  if (!baseUrl || !token) {
    throw new Error(
      'We cannot find your Dinodia Hub on the home Wi-Fi. Switch to Dinodia Cloud to control your place.'
    );
  }

  await handleDeviceCommand({
    ha: {
      baseUrl,
      longLivedToken: token,
    },
    entityId: device.entityId,
    command,
    value,
    blindTravelSeconds: device.blindTravelSeconds ?? null,
  });
}
