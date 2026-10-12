$ErrorActionPreference = 'Stop'
$researchDirectory = $PSScriptRoot
$packageNames = @(
  '@rhwp/editor',
  '@docx-editor.dev/react',
  '@docx-editor.dev/core',
  '@office-kit/xlsx',
  'pptx-react-viewer',
  '@univerjs/core',
  '@fortune-sheet/react'
)
$packageSnapshots = foreach ($packageName in $packageNames) {
  $registryUrl = 'https://registry.npmjs.org/' + [uri]::EscapeDataString($packageName)
  $metadata = Invoke-RestMethod -Uri $registryUrl -TimeoutSec 30
  $version = $metadata.'dist-tags'.latest
  $release = $metadata.versions.$version
  [ordered]@{
    name = $packageName
    observedVersion = $version
    publishedAt = $metadata.time.$version
    license = $release.license
    source = $registryUrl
    repository = $release.repository
    gitHead = $release.gitHead
    engines = $release.engines
    peerDependencies = $release.peerDependencies
    integrity = $release.dist.integrity
    tarball = $release.dist.tarball
  }
}
$snapshot = [ordered]@{
  observedAt = (Get-Date).ToUniversalTime().ToString('o')
  purpose = 'Research metadata only. Observed latest versions are evaluation candidates, not approved dependency pins.'
  packages = @($packageSnapshots)
}
$snapshot | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $researchDirectory 'research-snapshot.json') -Encoding utf8
$rhwp = $packageSnapshots | Where-Object { $_.name -eq '@rhwp/editor' } | Select-Object -First 1
$typesUrl = 'https://raw.githubusercontent.com/edwardkim/rhwp/' + $rhwp.gitHead + '/npm/editor/index.d.ts'
$types = Invoke-RestMethod -Uri $typesUrl -TimeoutSec 30
[ordered]@{
  source = $typesUrl
  scope = 'Declarations at the npm gitHead; not a browser runtime test or a tarball-content verification.'
  createStudioDeclared = $types.Contains('function createStudio(')
  toolbarVisibilityDeclared = $types.Contains('toolbar: boolean;')
  commandsContextDeclared = $types.Contains('context(): Promise<Record<string, unknown>>;')
  documentChangedEventReasonDeclaration = [regex]::Match($types, "reason: 'agent_apply' \| 'agent_revert';").Value
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $researchDirectory 'rhwp-api-observation.json') -Encoding utf8
Write-Output ('Saved package metadata for ' + $packageSnapshots.Count + ' packages.')
