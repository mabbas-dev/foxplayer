const express = require('express');
const http = require('http');
const https = require('https');
const router = express.Router();
const { streamManager } = require('../services/hlsSegmenter');

/**
 * GET /api/stream/live/:streamId.m3u8?url=<upstream_url>
 * Returns dynamically generated HLS manifest with sliding window of .ts chunks
 */
router.get('/live/:streamId.m3u8', async (req, res) => {
  const { streamId } = req.params;
  const rawUrl = req.query.url;

  if (!rawUrl) {
    return res.status(400).send('#EXTM3U\n#EXT-X-ERROR: Missing url query parameter\n');
  }

  let upstreamUrl = decodeURIComponent(rawUrl);

  // Guard against accidental nested/recursive proxy URL parameters
  while (upstreamUrl.includes('/api/stream/live/') && (upstreamUrl.includes('?url=') || upstreamUrl.includes('&url='))) {
    const match = upstreamUrl.match(/[?&]url=([^&]+)/);
    if (match) {
      try {
        upstreamUrl = decodeURIComponent(match[1]);
      } catch (_e) {
        upstreamUrl = match[1];
      }
    } else {
      break;
    }
  }

  const startTime = Date.now();
  console.log(`[Stream Route] ⚡ Incoming request for streamId: ${streamId} from ${req.ip}`);

  try {
    const session = streamManager.getOrCreate(streamId, upstreamUrl);

    // Wait for at least 2 segments before serving the initial playlist so iOS AVPlayer
    // receives a compliant live sliding window (>= 2 segments, ~1.3-1.8s buffer)
    // preventing immediate buffer underrun and CoreMedia stalls (-16830).
    await session.waitForSegments(2, 3500);

    const elapsedMs = Date.now() - startTime;
    console.log(`[Stream Route] 🎯 Playlist generated for ${streamId} in ${elapsedMs}ms (segments: ${session.segments.size})`);

    // If stream failed upstream or has 0 segments, do NOT send an empty playlist (which hangs AVPlayer).
    // Send HTTP 503 so AVPlayer recognizes the failure immediately.
    if (session.error || session.segments.size === 0) {
      console.warn(`[Stream Route] Stream ${streamId} failed or offline after ${elapsedMs}ms: ${session.error?.message || 'no segments'}`);
      res.set({
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      });
      return res.status(503).send('Stream unavailable or offline');
    }

    const proto = req.protocol || 'http';
    const host = req.get('host');
    const baseUrl = `${proto}://${host}/api/stream/live/${streamId}`;
    const playlist = session.getPlaylist(baseUrl);

    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
    });

    res.send(playlist);
  } catch (err) {
    console.error(`[Stream Route] Error serving playlist for ${streamId}:`, err.message);
    res.status(500).send('#EXTM3U\n#EXT-X-ERROR: Internal Server Error\n');
  }
});

/**
 * GET /api/stream/live/:streamId/segment-:seq.ts
 * Returns individual MPEG-TS chunk with Content-Length and video/mp2t MIME type
 */
router.get('/live/:streamId/segment-:seq.ts', (req, res) => {
  const { streamId, seq } = req.params;
  const session = streamManager.getSession(streamId);

  if (!session) {
    return res.status(404).send('Stream session not found');
  }

  const segment = session.getSegment(seq);
  if (!segment) {
    return res.status(404).send('Segment not found or expired');
  }

  res.set({
    'Content-Type': 'video/mp2t',
    'Content-Length': segment.buffer.length,
    'Cache-Control': 'public, max-age=10',
    'Access-Control-Allow-Origin': '*',
  });

  res.end(segment.buffer);
});

/**
 * POST /api/stream/live/:streamId/stop
 * Terminates upstream streaming session immediately when user switches channel or unmounts player
 */
router.all('/live/:streamId/stop', (req, res) => {
  const { streamId } = req.params;
  const stopped = streamManager.stop(streamId);
  res.json({ success: true, streamId, stopped });
});

/**
 * GET /api/stream/vod?url=<upstream_url>
 * Proxies progressive VOD streams (Movies and Series) with HTTP Byte-Range support (206 Partial Content)
 * and industry-standard IPTV User-Agent, allowing Apple AVPlayer to seek and stream progressive video.
 */
router.get('/vod', (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res.status(400).send('Missing url query parameter');
  }

  let upstreamUrl = decodeURIComponent(rawUrl);
  const isHttps = upstreamUrl.startsWith('https:');
  const client = isHttps ? https : http;

  const headers = {
    'User-Agent': 'IPTVSmartersPro/3.1.5 (Linux; Android 12)',
    'Accept': '*/*',
    'Connection': 'keep-alive',
  };

  // Forward Range header from AVPlayer
  if (req.headers.range) {
    headers['Range'] = req.headers.range;
  }

  const upstreamReq = client.get(upstreamUrl, { headers, timeout: 20000 }, (upstreamRes) => {
    // Handle redirects
    if (upstreamRes.statusCode >= 300 && upstreamRes.statusCode < 400 && upstreamRes.headers.location) {
      const nextUrl = new URL(upstreamRes.headers.location, upstreamUrl).toString();
      return res.redirect(upstreamRes.statusCode, `/api/stream/vod?url=${encodeURIComponent(nextUrl)}`);
    }

    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Accept-Ranges': 'bytes',
      'Content-Type': upstreamRes.headers['content-type'] || 'video/mp4',
    };

    if (upstreamRes.headers['content-length']) {
      responseHeaders['Content-Length'] = upstreamRes.headers['content-length'];
    }
    if (upstreamRes.headers['content-range']) {
      responseHeaders['Content-Range'] = upstreamRes.headers['content-range'];
    }

    res.writeHead(upstreamRes.statusCode, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    console.error('[VOD Proxy] Request error:', err.message);
    if (!res.headersSent) {
      res.status(502).send('Upstream server connection failed');
    }
  });

  req.on('close', () => {
    upstreamReq.destroy();
  });
});

module.exports = router;
