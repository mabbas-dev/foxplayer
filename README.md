# FOX PLAYER

> Premium, High-Performance IPTV & Media Player Mobile Application, Web Management Portal, and REST API.

FOX PLAYER is a complete, production-grade IPTV solution built for multi-platform streaming (Android TV, Firestick, Samsung Tizen, LG webOS, Apple TV / iOS, Windows, and mobile).

---

## Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │            FOX PLAYER APP              │
                      │  (Expo / React Native Mobile & TV App) │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │          api.foxplayer.app             │
                      │      (PHP 8.2+ REST API Engine)        │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │         u139837297_fox_db              │
                      │       (MariaDB / MySQL Server)         │
                      └──────────────────▲─────────────────────┘
                                         │
                                         │
                      ┌──────────────────┴─────────────────────┐
                      │           foxplayer.app                │
                      │  (Web Pairing, Activation & Admin)     │
                      └────────────────────────────────────────┘
```

1. **Mobile / TV Application (`/src`)**:
   - Expo SDK 57 / React Native 0.86 application.
   - Built with cinematic dark UI (`#080A0F`, `#0D1117`, `#161C26`) and Fox Orange accents (`#F97316`).
   - Supports Xtream Codes API (Live, VOD movies, TV series with seasons/episodes) and M3U playlists.
   - Channel number direct zapping, instant live search, parental controls PIN protection, favorites drawer.
   - Authoritative backend subscription & trial validation.

2. **Web Management Portal (`/server-web` -> `https://foxplayer.app`)**:
   - **Home (`/`)**: Hero showcase, platform availability, legal disclaimer, feature grid, pricing plans (1 Year & Forever), FAQ.
   - **Upload List (`/upload` & `/manage`)**:
     * Upload M3U or Xtream Codes playlists to any device by Device ID or MAC Address.
     * View and switch active playlists (Multi-List management).
     * Wipe all playlists from MAC address.
     * Lock / Unlock MAC address to protect against unauthorized modifications.
   - **Device Activation (`/activation`)**:
     * Query live subscription status and days left.
     * Activate device with 1 Year (55.00 MAD / ~4.99 €) or Forever Lifetime (137.00 MAD / ~11.00 €).
   - **Administrative Control Panel (`/admin`)**:
     * Master authentication.
     * Real-time KPI statistics: Total devices, active devices, trial users, paid users (1 Year vs Forever), total playlists.
     * **Default Free Trial Days Controller**: Configure default app trial duration (e.g. 7, 14, 30 days) and toggle trial on/off.
     * **User & Device Directory**: Search by Device ID or MAC, filter by plan status, view playlists configured per user, extend/edit subscriptions, and audit logs.

3. **Backend REST API (`/server-api` -> `https://api.foxplayer.app`)**:
   - High-throughput PHP 8.2+ REST API with clean URLs (no `.php` in URL).
   - Direct connection to MySQL / MariaDB (`u139837297_fox_db`).
   - AES-256 cipher encryption for stored Xtream passwords and credentials.

---

## MySQL Database Schema

The database `u139837297_fox_db` comprises:
- `devices`: Registered devices, MAC addresses, status, last seen, ID lock.
- `playlists`: Stored M3U and Xtream playlist sources with encrypted credentials.
- `device_playlists`: Junction table supporting multiple playlists per device, active playlist tracking.
- `subscriptions`: Authoritative license records (trial, year_1, forever), start and expiration timestamps.
- `subscription_settings`: Authoritative default trial days and trial toggle.
- `playlist_sync_logs`: Performance and channel count synchronization metrics.
- `subscription_audit_logs`: Administrative change history.
- `admins`: Administrator credentials.

---

## Development & Deployment

### Mobile Application
```bash
# Start development server
npx expo start

# Run lint and typecheck
npx expo lint
npx tsc --noEmit
```

### Server Deployment
The server files in `server-api` and `server-web` are deployed to:
- `api.foxplayer.app`: `/home/u139837297/domains/api.foxplayer.app/public_html`
- `foxplayer.app`: `/home/u139837297/domains/foxplayer.app/public_html`

Automated deployment scripts:
```bash
python scripts/deploy_api.py
python scripts/deploy_web.py
```

---

## License

FOX PLAYER is proprietary software. All rights reserved.
