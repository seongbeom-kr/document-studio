param([string]$InputDoc = '.build\fixes-0.2.7\inline-title-chrome.docx', [string]$ObservationName = 'word-inline-layout.json')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$inputPath = [IO.Path]::GetFullPath((Join-Path $root $InputDoc))
if (!$inputPath.StartsWith($root + [IO.Path]::DirectorySeparatorChar)) { throw 'Input must remain within this SDK workspace.' }
if ([IO.Path]::GetFileName($ObservationName) -cne $ObservationName) { throw 'Observation name must be a local filename.' }
$outputPath = Join-Path $root ('.build\fixes-0.2.7\' + $ObservationName)
$word = $null; $document = $null; $ownsWord = $false
try {
  $word = New-Object -ComObject Word.Application
  if ($word.Documents.Count -ne 0) { throw 'A fresh Word instance without user documents is required.' }
  $ownsWord = $true
  $word.Visible = $false; $word.DisplayAlerts = 0; $word.AutomationSecurity = 3
  $document = $word.Documents.Open($inputPath, $false, $true, $false)
  $document.Repaginate()
  $shape = $document.InlineShapes.Item(1)
  $position = $shape.Range.Start
  $observations = foreach ($offset in @([Math]::Max(0, ($position - 1)), $position, ($position + 1), ($position + 2))) {
    $range = $document.Range($offset, $offset + 1)
    [ordered]@{ offset=$offset; text=$range.Text; xPt=$range.Information(5); yPt=$range.Information(6); line=$range.Information(10) }
  }
  $result = [ordered]@{ application='Microsoft Word'; version=$word.Version; imageWidthPt=$shape.Width; imageHeightPt=$shape.Height; positions=@($observations); paragraphs=$document.Paragraphs.Count; pages=$document.ComputeStatistics(2) }
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outputPath -Encoding utf8
  if ([Math]::Abs($shape.Width - 80 * 72 / 25.4) -gt 0.1 -or [Math]::Abs($shape.Height - 20 * 72 / 25.4) -gt 0.1) { throw 'Word image dimensions differ from 80 x 20 mm.' }
  $paragraphStart = $shape.Range.Paragraphs.Item(1).Range.Start
  if (($position -gt $paragraphStart -and $observations[0].line -ne $observations[1].line) -or $observations[1].line -ne $observations[2].line) { throw 'Inline image and adjacent text are not on the same line in Word.' }
  if ($observations[2].xPt -lt ($observations[1].xPt + $shape.Width - 1)) { throw 'Word reports horizontal overlap after the image.' }
  Write-Output 'Word confirms 80 x 20 mm inline image with adjacent text on the same line, without horizontal overlap.'
} finally {
  if ($null -ne $document) { $document.Close(0); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($null -ne $word) { if ($ownsWord) { $word.Quit() }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
}
