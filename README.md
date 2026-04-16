# Hostier Extension

Chrome extension for Hostier platform connections.

## Scripts

- `npm run dev`
- `npm run package:prod`
- `npm run verify`
- `npm run publish:webstore`

`npm run package:prod` still writes `dist/hostier-extension.zip`, but that ZIP is
now only the upload bundle used for Chrome Web Store releases.

## Release automation

Tag pushes matching `v*` run the release workflow. The workflow verifies the
extension, uploads `dist/hostier-extension.zip` to the Chrome Web Store API,
and submits the item for immediate publication on review approval.

Required GitHub configuration:

- secret `CWS_SERVICE_ACCOUNT_JSON`
- variable `CWS_PUBLISHER_ID`
- variable `CWS_EXTENSION_ID`
