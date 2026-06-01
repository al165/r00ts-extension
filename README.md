# r00ts Browser Extension

Made in collaboration with [AIxDESIGN](https://aixdesign.co).
Support from [Stimulerings Fonds](https://www.stimuleringsfonds.nl/).

Currently available for Chrome and Firefox.

See also [r00ts-website](https://github.com/al165/r00ts-website) for the
companion site.

> [!IMPORTANT]
> Currently under active development!

## Build Instructions

Clone this repo and run install the dependencies:

```sh
git clone git@github.com:al165/r00ts-extension.git
cd r00ts-extension/
npm install
```

Create a `.env` file with the following keys:

```env
API_ENDPOINT=<r00ts URL>/api/ip/
```

- `API_ENDPOINT`: address to an instance of
  [r00ts-website](https://github.com/al165/r00ts-website)

Note this `.env` file is untracked by git.

Next, build the extension:

```sh
# For development build:
npm run build:dev:all

# For production:
npm run build:production:all
```

This will produce 2 unpacked directories under `./dist/`, one for each browser.

To load the extension in your browser:

- Firefox: visit `about:debugging` in the address bar, click "This Firefox",
  "Load Temporary Add-on..." and select `manifest.json` in `dist/firefox-extension`
- Chrome: visit `chrome://extensions/` in the address bar, click "Load unpacked"
  and select `manifest.json` in `dist/chrome-extension`
