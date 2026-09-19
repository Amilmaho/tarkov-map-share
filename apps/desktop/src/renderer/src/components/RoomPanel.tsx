import { useState } from "react";

import type { ClientState } from "@tarkov-map-share/shared";

import { formatFreshness, formatPosition } from "../format";
import { useNow } from "../hooks/useNow";
import { useMapStore } from "../store";

const STATUS_LABELS: Record<ClientState, string> = {
  idle: "未连接",
  connecting: "连接中",
  open: "已连接",
  reconnecting: "重连中",
  closed: "已断开",
};

function statusClass(status: ClientState): string {
  if (status === "open") return "badge--ok";
  if (status === "connecting" || status === "reconnecting") return "badge--warn";
  return "badge--unknown";
}

export function RoomPanel() {
  const now = useNow();
  const connection = useMapStore((state) => state.connection);
  const room = useMapStore((state) => state.room);
  const members = useMapStore((state) => state.members);
  const players = useMapStore((state) => state.players);
  const me = useMapStore((state) => state.me);

  const setDisplayName = useMapStore((state) => state.setDisplayName);
  const startHosting = useMapStore((state) => state.startHosting);
  const joinRoom = useMapStore((state) => state.joinRoom);
  const leaveRoom = useMapStore((state) => state.leaveRoom);

  const [address, setAddress] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [passcode, setPasscode] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied("复制失败");
    }
  };

  if (room === null) {
    return (
      <section className="panel">
        <header className="panel__head">
          <h2>联机</h2>
          <span className={`badge ${statusClass(connection.status)}`}>{STATUS_LABELS[connection.status]}</span>
        </header>

        <div className="panel__actions">
          <input
            className="input"
            placeholder="你的昵称"
            aria-label="昵称"
            value={me.displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        <div className="panel__actions">
          <button type="button" className="btn btn--primary" onClick={() => void startHosting()}>
            创建房间（我是主机）
          </button>
        </div>
        <p className="panel__hint">
          无需服务器：房间跑在你自己这台电脑上，队友通过局域网或虚拟局域网地址连进来。
        </p>

        <p className="panel__hint">加入朋友的房间：</p>
        <div className="panel__actions">
          <input
            className="input"
            placeholder="地址，例如 192.168.1.23:8787"
            aria-label="主机地址"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </div>
        <div className="panel__actions">
          <input
            className="input"
            placeholder="房间码"
            aria-label="房间码"
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
          />
          <input
            className="input"
            placeholder="口令（可选）"
            aria-label="口令"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
          />
          <button
            type="button"
            className="btn"
            onClick={() =>
              void joinRoom({
                address,
                roomId: roomCode,
                displayName: me.displayName,
                ...(passcode === "" ? {} : { passcode }),
              })
            }
          >
            加入
          </button>
        </div>

        {connection.error !== null ? (
          <p className="panel__message panel__message--bad">{connection.error}</p>
        ) : null}
      </section>
    );
  }

  const hostAddress = connection.hostAddresses[0];
  const hostPort = connection.hostPort;
  const isHost = connection.role === "host" && hostPort !== null;
  const shareableAddresses = isHost ? connection.hostAddresses : [];
  const invite = isHost && hostAddress !== undefined ? `${hostAddress}:${hostPort} ${room.id}` : "";

  const rows = Object.values(members).sort((a, b) => a.joinedAt - b.joinedAt);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>
          房间 <span className="room-code">{room.id}</span>
        </h2>
        <span className={`badge ${statusClass(connection.status)}`}>{STATUS_LABELS[connection.status]}</span>
      </header>

      <div className="panel__actions">
        {invite !== "" ? (
          <button type="button" className="btn btn--primary" onClick={() => void copy(invite, "邀请")}>
            复制邀请
          </button>
        ) : null}
        <button type="button" className="btn btn--ghost" onClick={() => leaveRoom()}>
          离开房间
        </button>
      </div>

      {invite !== "" ? (
        <>
          <p className="panel__hint">
            把下面任一地址 + 房间码发给队友：同一个 WiFi 用 192.168 开头的；
            异地要先用 Tailscale / ZeroTier 这类工具组成虚拟局域网，再用 100.x 开头的地址。
          </p>
          <ul className="member-list">
            {shareableAddresses.map((address) => (
              <li className="member-row" key={address}>
                <span className="member-row__coords">
                  {address}:{hostPort}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => void copy(`${address}:${hostPort} ${room.id}`, "邀请")}
                >
                  复制
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="panel__hint">
        队友 {rows.length}/{room.maxMembers}：坐标就是共享的内容，队友各自在地图上对照。
      </p>

      <ul className="member-list">
        {rows.map((member) => {
          const player = players[member.userId];
          const isMe = member.userId === me.userId;
          const freshness = formatFreshness(player?.positionCapturedAt ?? null, now);
          const position = player?.position;

          return (
            <li className="member-row" key={member.userId}>
              <span className="dot" style={{ background: member.color }} />
              <span className="member-row__name">
                {member.displayName}
                {isMe ? "（我）" : ""}
              </span>
              {position !== undefined ? (
                <>
                  <span className="member-row__coords">{formatPosition(position.x, position.z)}</span>
                  <span className={`badge badge--${freshness.level}`}>{freshness.label}</span>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void copy(`${position.x.toFixed(1)}, ${position.z.toFixed(1)}`, "坐标")}
                  >
                    复制
                  </button>
                </>
              ) : (
                <span className="text-muted">位置未知</span>
              )}
            </li>
          );
        })}
      </ul>

      {copied !== null ? <p className="panel__message">已复制{copied}</p> : null}
      {connection.error !== null ? (
        <p className="panel__message panel__message--bad">{connection.error}</p>
      ) : null}
    </section>
  );
}
