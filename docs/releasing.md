# Release Process

Merging a pull request does not publish a GitHub Release. The release workflow in
`.github/workflows/release.yml` runs only when a tag matching `1.2.3` is pushed.

## Versioning

Use semantic versioning:

- Patch (`1.4.0` to `1.4.1`): backward-compatible bug fix.
- Minor (`1.4.1` to `1.5.0`): backward-compatible feature.
- Major (`1.5.0` to `2.0.0`): breaking behavior or API change.

Use tags without a `v` prefix. The workflow pattern accepts `1.4.1`, not
`v1.4.1`.

## Development Workflow

1. Create a feature or fix branch from current `main`. Do not commit directly to
   `main`.
2. Implement code, regression tests, and relevant documentation.
3. Record user-visible changes under `Unreleased` in `CHANGELOG.md`.
4. Run the validation commands below.
5. Submit a pull request to `main` and wait for CI to pass.

## Release Checklist

1. Create a release branch from current `main`.
2. Update the version in both `package.json` and the root package entries in
   `package-lock.json`.
3. Move applicable `CHANGELOG.md` entries from `Unreleased` to a dated version
   section.
4. Add concise release notes to `README.md`.
5. Run:

   ```bash
   npm ci
   npm run check-types
   npm run lint
   xvfb-run -a npm test
   npm run package
   npx @vscode/vsce package --no-dependencies
   ```

6. Install the generated `.vsix` and smoke-test representative BLF files.
7. Submit and merge the release pull request. Wait for `main` CI to pass.
8. Fetch merged `main`, then create an annotated tag on the merge commit. Squash
   merges produce a new commit hash, so do not tag the pre-merge branch commit.

   ```bash
   VERSION=1.4.1
   git fetch origin main:refs/remotes/origin/main --tags
   git tag -a "$VERSION" origin/main -m "Version $VERSION"
   git push origin "$VERSION"
   ```

9. Verify the Release workflow and published asset:

   ```bash
   gh run list --workflow Release --limit 1
   gh release view "$VERSION"
   ```

The workflow builds the extension, packages the `.vsix`, creates the GitHub
Release, and uploads the artifact. If the release already exists, it replaces
the existing `.vsix` asset.

The workflow then publishes the same `.vsix` to each registry whose secret is
set: `OVSX_PAT` for Open VSX, `VSCE_PAT` for the VS Code Marketplace. A step
whose secret is missing is skipped, so publish to that registry manually.
Both publish steps use `--skip-duplicate`, so rerunning a failed job is safe.

After the workflow finishes, check both listings:

- <https://open-vsx.org/extension/mafatpanah/blf-viewer>
- <https://marketplace.visualstudio.com/items?itemName=mafatpanah.blf-viewer>

## Registry Credentials

- **Open VSX**: Generate an Access Token at [open-vsx.org](https://open-vsx.org/)
  (User Settings -> Access Tokens). Ensure the Eclipse Publisher Agreement is
  signed. Add the token to GitHub repository secrets as `OVSX_PAT`.
- **VS Code Marketplace**: Generate a Personal Access Token in Azure DevOps
  with `Marketplace (Manage)` scope. Add to GitHub repository secrets as `VSCE_PAT`.

To publish a release asset manually (Node 22 or newer):

```bash
VERSION=1.4.2
gh release download "$VERSION" -p '*.vsix'
npx ovsx publish "blf-viewer-$VERSION.vsix" -p "$OVSX_PAT"
npx @vscode/vsce publish --packagePath "blf-viewer-$VERSION.vsix" -p "$VSCE_PAT"
```

## Recovery

- If validation fails before tagging, fix it through another pull request.
- If the tag was pushed but the workflow failed, fix the workflow or source and
  rerun the failed job.
- Never move or overwrite a published version tag. Publish a new patch version
  instead.
