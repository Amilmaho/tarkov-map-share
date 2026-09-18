import { networkInterfaces } from "node:os";

export type LanAddress = {
  /** 网卡名称，例如 `en0`、`以太网` */
  iface: string;
  address: string;
};

/** 列出本机可用于分享给队友的 IPv4 地址（排除回环与内部地址） */
export function listLanAddresses(): LanAddress[] {
  const addresses: LanAddress[] = [];
  const interfaces = networkInterfaces();

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      addresses.push({ iface: name, address: entry.address });
    }
  }

  return addresses;
}

/** 生成给队友看的邀请串 */
export function formatInvite(roomId: string, host: string, port: number): string {
  return `${roomId}@${host}:${port}`;
}
