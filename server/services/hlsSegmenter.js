const http = require('http');
const https = require('https');
const { URL } = require('url');

// Shared Keep-Alive agents to avoid repeated TCP/TLS handshake latency on stream connect
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 12000,
  keepAliveMsecs: 30000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 12000,
  keepAliveMsecs: 30000,
});

/**
 * Live HLS Stream Session
 * Transmuxes an upstream progressive MPEG-TS stream into RFC 8216 compliant HLS segments on the fly.
 * Optimized for ultra-low startup latency on Apple AVPlayer (iOS).
 */
class StreamSession {
  constructor(streamId, upstreamUrl) {
    this.streamId = String(streamId);
    this.upstreamUrl = upstreamUrl;
    this.segments = new Map(); // seq -> { seq, buffer, duration }
    this.mediaSequence = 1;
    this.targetDuration = 2;
    this.lastAccess = Date.now();
    this.lastSegTime = Date.now();
    this.active = false;
    this.req = null;
    this.res = null;
    this.currentPackets = [];
    this.currentBytes = 0;
    this.latestPat = null;
    this.latestPmt = null;
    this.pmtPid = null;
    this.videoPid = null;
    this.hasSeenFirstKeyframe = false;
    this.listeners = [];
    this.error = null;
  }

  start(delayMs = 0) {
    if (this.active) return;
    this.active = true;
    this.error = null;
    this.lastAccess = Date.now();
    if (delayMs > 0) {
      setTimeout(() => {
        if (this.active) {
          this._connect(this.upstreamUrl, 0);
        }
      }, delayMs);
    } else {
      this._connect(this.upstreamUrl, 0);
    }
  }

  _notifyListeners() {
    const activeListeners = [...this.listeners];
    this.listeners = [];
    for (const cb of activeListeners) {
      try { cb(); } catch (_e) {}
    }
  }

  _connect(targetUrl, redirects) {
    if (redirects > 5 || !this.active) return;
    const isHttps = targetUrl.startsWith('https:');
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    try {
      this.req = client.get(targetUrl, {
        agent,
        headers: {
          'User-Agent': 'IPTVSmartersPro/3.1.5 (Linux; Android 12)',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          'Connection': 'keep-alive',
        },
        timeout: 12000,
      }, (res) => {
        this.res = res;
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          return this._connect(nextUrl, redirects + 1);
        }
        if (res.statusCode !== 200) {
          console.error(`[HLS Proxy] Upstream returned HTTP ${res.statusCode} for stream ${this.streamId}`);
          this.error = new Error(`Upstream returned HTTP ${res.statusCode}`);
          this.active = false;
          this._notifyListeners();
          return;
        }
        this._processStream(res);
      });

      this.req.on('error', (err) => {
        if (this.active) {
          console.error(`[HLS Proxy] Upstream request error for stream ${this.streamId}:`, err.message);
          this.error = err;
          this.active = false;
          this._notifyListeners();
        }
      });
      this.req.on('timeout', () => {
        if (this.req) {
          this.error = new Error('Upstream connection timed out');
          this.active = false;
          this._notifyListeners();
          this.req.destroy();
        }
      });
    } catch (e) {
      console.error(`[HLS Proxy] Connection error for stream ${this.streamId}:`, e.message);
      this.error = e;
      this.active = false;
      this._notifyListeners();
    }
  }

  _processStream(res) {
    let remainder = Buffer.alloc(0);
    this.lastSegTime = Date.now();

    res.on('data', (chunk) => {
      if (!this.active) return;
      const data = remainder.length > 0 ? Buffer.concat([remainder, chunk]) : chunk;
      let offset = 0;

      while (offset + 188 <= data.length) {
        if (data[offset] === 0x47) {
          const pid = ((data[offset + 1] & 0x1F) << 8) | data[offset + 2];
          const packet = data.slice(offset, offset + 188);

          if (pid === 0) {
            this.latestPat = packet;
            if (packet[4] === 0x00 && packet.length >= 17) {
              this.pmtPid = ((packet[15] & 0x1F) << 8) | packet[16];
            }
          } else if (this.pmtPid && pid === this.pmtPid) {
            this.latestPmt = packet;
            // Parse elementary streams in PMT to identify videoPid
            const pusi = (packet[1] & 0x40) !== 0;
            if (pusi && packet.length >= 21) {
              const pointer = packet[4];
              const sectionStart = 5 + pointer;
              if (sectionStart + 12 < packet.length) {
                const progInfoLen = ((packet[sectionStart + 10] & 0x0F) << 8) | packet[sectionStart + 11];
                let esOffset = sectionStart + 12 + progInfoLen;
                while (esOffset + 5 <= packet.length - 4) {
                  const streamType = packet[esOffset];
                  const esPid = ((packet[esOffset + 1] & 0x1F) << 8) | packet[esOffset + 2];
                  // Video stream types: 0x1B (H.264), 0x24 (H.265), 0x02 / 0x01 (MPEG-2/1), 0x10 (MPEG-4)
                  if (streamType === 0x1B || streamType === 0x24 || streamType === 0x02 || streamType === 0x01 || streamType === 0x10) {
                    this.videoPid = esPid;
                    break;
                  }
                  const esInfoLen = ((packet[esOffset + 3] & 0x0F) << 8) | packet[esOffset + 4];
                  esOffset += 5 + esInfoLen;
                }
              }
            }
          }

          // Inspect for video keyframe ONLY on video packets (H.264 SPS=7/IDR=5, H.265 VPS=32/SPS=33/IDR=19/20)
          let isKeyframe = false;
          const isVideoPacket = this.videoPid ? (pid === this.videoPid) : (pid !== 0 && pid !== this.pmtPid);

          if (isVideoPacket) {
            for (let i = 4; i < 184; i++) {
              if (packet[i] === 0x00 && packet[i + 1] === 0x00 && (packet[i + 2] === 0x01 || (packet[i + 2] === 0x00 && packet[i + 3] === 0x01))) {
                const nalPos = packet[i + 2] === 0x01 ? i + 3 : i + 4;
                if (nalPos < 188) {
                  const nalByte = packet[nalPos];
                  const nalTypeH264 = nalByte & 0x1F;
                  const nalTypeH265 = (nalByte >> 1) & 0x3F;
                  const isMpeg2Keyframe = (packet[i + 2] === 0x01) && (
                    packet[i + 3] === 0xB3 ||
                    packet[i + 3] === 0xB8 ||
                    (packet[i + 3] === 0x00 && i + 5 < 188 && ((packet[i + 5] >> 3) & 0x07) === 1)
                  );
                  if (
                    nalTypeH264 === 7 || nalTypeH264 === 5 ||
                    nalTypeH265 === 32 || nalTypeH265 === 33 || nalTypeH265 === 19 || nalTypeH265 === 20 ||
                    isMpeg2Keyframe
                  ) {
                    isKeyframe = true;
                    if (!this.videoPid) this.videoPid = pid;
                    break;
                  }
                }
              }
            }
          }

          // Discard pre-keyframe packets so Segment 1 starts cleanly on an authentic video keyframe
          if (!this.hasSeenFirstKeyframe) {
            if (isKeyframe) {
              this.hasSeenFirstKeyframe = true;
              this.lastSegTime = Date.now();
              this.currentPackets.push(packet);
              this.currentBytes += 188;
            }
            offset += 188;
            continue;
          }

          const now = Date.now();
          const elapsed = (now - this.lastSegTime) / 1000;

          // iOS AVPlayer multi-segment buffer compliance (optimized for ultra-low startup latency):
          // - Segment 1: cut at ~0.5s with >= 35KB on keyframe (fast initial segment)
          // - Segment 2: cut at ~0.8s with >= 60KB (completes sliding window in ~1.3s)
          // - Segment 3+: cut at ~1.6s with >= 160KB (stable continuous streaming)
          const isFirstSeg = this.segments.size === 0;
          const isSecondSeg = this.segments.size === 1;

          const minDur = isFirstSeg ? 0.5 : (isSecondSeg ? 0.8 : 1.6);
          const minBytes = isFirstSeg ? 35000 : (isSecondSeg ? 60000 : 160000);

          // Split segment when reaching target duration on genuine video keyframe
          if (isKeyframe && elapsed >= minDur && this.currentBytes > minBytes) {
            this._cutSegment(elapsed);
          } else if (elapsed >= 3.0 && this.currentBytes > 100000) {
            // Safety cap: cut segment if elapsed exceeds 3.0s
            this._cutSegment(elapsed);
          }

          this.currentPackets.push(packet);
          this.currentBytes += 188;
          offset += 188;
        } else {
          offset++;
        }
      }
      remainder = data.slice(offset);
    });

    res.on('end', () => {
      if (this.currentPackets.length > 0) {
        this._cutSegment((Date.now() - this.lastSegTime) / 1000);
      }
    });

    res.on('error', (err) => {
      if (this.active) {
        console.error(`[HLS Proxy] Upstream response stream error for ${this.streamId}:`, err.message);
      }
    });
  }

  _cutSegment(duration) {
    const headers = [];
    if (this.latestPat) headers.push(this.latestPat);
    if (this.latestPmt) headers.push(this.latestPmt);

    const segBuffer = Buffer.concat([...headers, ...this.currentPackets]);
    const seq = this.mediaSequence++;
    const segDuration = Math.max(0.3, Number(duration.toFixed(3)));

    this.segments.set(seq, { seq, buffer: segBuffer, duration: segDuration });
    this.currentPackets = [];
    this.currentBytes = 0;
    this.lastSegTime = Date.now();

    // Maintain a rolling window of max 10 segments in memory (~15-20MB max)
    while (this.segments.size > 10) {
      const oldestSeq = this.segments.keys().next().value;
      this.segments.delete(oldestSeq);
    }

    // Wake up any pending playlist requests
    const activeListeners = [...this.listeners];
    for (const cb of activeListeners) {
      try { cb(); } catch (_e) {}
    }
  }

  waitForSegments(count = 2, timeoutMs = 7000) {
    if (this.error || this.segments.size >= count || !this.active) return Promise.resolve();
    return new Promise((resolve) => {
      let resolved = false;
      let firstSegTimer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (firstSegTimer) clearTimeout(firstSegTimer);
        this.listeners = this.listeners.filter((l) => l !== check);
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve();
        }
      }, timeoutMs);

      const check = () => {
        if (!resolved) {
          if (this.error || this.segments.size >= count || !this.active) {
            resolved = true;
            cleanup();
            resolve();
            return;
          }
          // Fast-start: as soon as at least 1 segment is ready, give a brief 350ms window
          // for a 2nd segment; if not ready, unblock immediately so iOS starts playback
          // instead of waiting the full timeout!
          if (this.segments.size >= 1 && !firstSegTimer) {
            firstSegTimer = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                cleanup();
                resolve();
              }
            }, 350);
          }
        }
      };

      this.listeners.push(check);

      // If at least 1 segment was already created before listener was attached, unblock fast
      if (this.segments.size >= 1 && !firstSegTimer) {
        firstSegTimer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve();
          }
        }, 150);
      }
    });
  }

  waitForFirstSegment(timeoutMs = 4500) {
    return this.waitForSegments(1, timeoutMs);
  }

  getPlaylist(baseUrl) {
    this.lastAccess = Date.now();
    const segList = Array.from(this.segments.values());
    if (segList.length === 0) {
      return '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:1\n#EXT-X-INDEPENDENT-SEGMENTS\n';
    }

    const firstSeq = segList[0].seq;
    let maxDur = 2;
    for (const s of segList) {
      if (s.duration > maxDur) maxDur = Math.ceil(s.duration);
    }

    let m3u8 = '#EXTM3U\n';
    m3u8 += '#EXT-X-VERSION:3\n';
    m3u8 += `#EXT-X-TARGETDURATION:${maxDur}\n`;
    m3u8 += `#EXT-X-MEDIA-SEQUENCE:${firstSeq}\n`;
    m3u8 += '#EXT-X-INDEPENDENT-SEGMENTS\n';

    for (const seg of segList) {
      m3u8 += `#EXTINF:${seg.duration.toFixed(3)},\n`;
      m3u8 += `${baseUrl}/segment-${seg.seq}.ts\n`;
    }

    return m3u8;
  }

  getSegment(seq) {
    this.lastAccess = Date.now();
    return this.segments.get(Number(seq)) || null;
  }

  touch() {
    this.lastAccess = Date.now();
  }

  stop() {
    this.active = false;
    if (this.res) {
      try { this.res.destroy(); } catch (_e) {}
      this.res = null;
    }
    if (this.req) {
      try { this.req.destroy(); } catch (_e) {}
      this.req = null;
    }
    this.segments.clear();
    this.currentPackets = [];
    while (this.listeners.length > 0) {
      const cb = this.listeners.shift();
      try { cb(); } catch (_e) {}
    }
  }
}

/**
 * Stream Manager
 * Manages active live stream sessions, single active stream enforcement (for IPTV provider max_connections: 1),
 * and automatic cleanup of idle streams.
 */
class StreamManager {
  constructor() {
    this.sessions = new Map(); // streamId -> StreamSession

    // Periodic idle reaper (every 5 seconds)
    setInterval(() => {
      this._reapIdle();
    }, 5000);
  }

  getOrCreate(streamId, upstreamUrl) {
    const key = String(streamId);
    let session = this.sessions.get(key);

    if (session && session.active && session.upstreamUrl === upstreamUrl) {
      session.touch();
      return session;
    }

    // Stop existing session for this streamId if URL changed
    if (session) {
      session.stop();
      this.sessions.delete(key);
    }

    // Provider single-connection enforcement: stop other active streams so provider line is not exhausted
    let hadActiveOther = false;
    for (const [otherId, otherSession] of this.sessions.entries()) {
      if (otherId !== key && otherSession.active) {
        console.log(`[HLS Proxy] Stopping background session ${otherId} to preserve provider line`);
        otherSession.stop();
        this.sessions.delete(otherId);
        hadActiveOther = true;
      }
    }

    session = new StreamSession(key, upstreamUrl);
    this.sessions.set(key, session);
    // Yield 60ms if another session was actively stopped, allowing the remote server to close the socket
    session.start(hadActiveOther ? 60 : 0);
    return session;
  }

  getSession(streamId) {
    return this.sessions.get(String(streamId)) || null;
  }

  stop(streamId) {
    const key = String(streamId);
    const session = this.sessions.get(key);
    if (session) {
      session.stop();
      this.sessions.delete(key);
      console.log(`[HLS Proxy] Session ${key} stopped`);
      return true;
    }
    return false;
  }

  _reapIdle() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      // If no requests received for 20 seconds, terminate session
      if (now - session.lastAccess > 20000) {
        console.log(`[HLS Proxy] Idle timeout for stream ${id}, releasing connection`);
        session.stop();
        this.sessions.delete(id);
      }
    }
  }
}

const streamManager = new StreamManager();

module.exports = {
  StreamSession,
  StreamManager,
  streamManager,
};
