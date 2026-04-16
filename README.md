# Infinite Tracker v1.1

A Cesium-based Infinite Flight live tracker with:
- Radar mode
- IFE mode (Welcome -> Start -> Flight Info / Glass Cockpit)
- Live aircraft polling
- Aircraft selection + follow
- Globe style toggles (labels/boundaries)
- Random aircraft jump

## Files
- `index.html`
- `style.css`
- `app.js`

## Setup

1. Serve files with a local static server (not `file://`).
2. Edit `app.js`:
   - `DEFAULT_API_KEY = "YOUR_INFINITE_FLIGHT_API_KEY"`
   - `CESIUM_ION_TOKEN = "YOUR_CESIUM_ION_TOKEN"`
3. Open the site, choose a server, click **Connect**.

## Notes

### Plane icon reliability
The app uses a generated vector data URL as primary icon and falls back to:
`https://infinite-tracker.tech/plane.svg`

## Controls
- **Connect**: starts live polling
- **Open Random Aircraft**: jumps to and selects a random active flight
- **Follow Selected**: camera tracks selected entity
- **IFE Mode**:
  1. Click aircraft
  2. Welcome screen appears
  3. Click **START**
  4. Use **Change View** to switch Flight Info / Glass Cockpit

## Troubleshooting
- If no aircraft appear:
  - ensure server selected + connected
  - verify key/token
  - check browser console for HTTP/API errors
- If map loads but flights don’t:
  - verify Infinite Flight API access/limits
- If UI seems frozen:
  - hard refresh (`Ctrl+F5`)
```
