param([string]$FixtureName='rich.docx', [string]$EditedName='edited.docx', [string]$ObservationName='word-observations.json')
$ErrorActionPreference = 'Stop'
foreach($name in @($FixtureName,$EditedName,$ObservationName)) { if([System.IO.Path]::GetFileName($name) -cne $name) {throw 'Native test names must be local filenames.'} }
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sourcePath = Join-Path $projectRoot ('fixtures\' + $FixtureName)
$editedPath = Join-Path $projectRoot ('.build\native-qa\' + $EditedName)
$resultPath = Join-Path $projectRoot ('.build\native-qa\' + $ObservationName)
$word = $null
$ownsWord = $false
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  if ($word.Documents.Count -ne 0) { throw 'Validation requires a fresh Word instance without user documents.' }
  $ownsWord = $true
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $observations = foreach ($file in @($sourcePath, $editedPath)) {
    $document = $word.Documents.Open($file, $false, $true, $false)
    $document.Repaginate()
    $result = [ordered]@{
      file = [System.IO.Path]::GetFileName($file)
      text = $document.Content.Text
      tables = $document.Tables.Count
      inlineImages = $document.InlineShapes.Count
      paragraphs = $document.Paragraphs.Count
      footnotes = $document.Footnotes.Count
      pages = $document.ComputeStatistics(2)
      firstParagraphFontSize = $document.Paragraphs.Item(1).Range.Font.Size
      firstParagraphLineSpacingRule = $document.Paragraphs.Item(1).Range.ParagraphFormat.LineSpacingRule
      headerText = $document.Sections.Item(1).Headers.Item(1).Range.Text
      footerText = $document.Sections.Item(1).Footers.Item(1).Range.Text
    }
    $document.Close(0)
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document)
    $document = $null
    $result
  }
  $original = $observations[0]
  $edited = $observations[1]
  [ordered]@{ application = 'Microsoft Word'; version = $word.Version; passed = $false; documents = @($observations) } | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $resultPath -Encoding utf8
  if ($original.text -cne $edited.text) { throw 'Microsoft Word reports changed document text.' }
  if ($original.tables -ne $edited.tables -or $original.inlineImages -ne $edited.inlineImages) { throw 'Microsoft Word reports missing tables or images.' }
  if ($original.headerText -cne $edited.headerText -or $original.footerText -cne $edited.footerText) { throw 'Header or footer text changed.' }
  if ($original.footnotes -ne $edited.footnotes) { throw 'Microsoft Word reports missing footnotes.' }
  if ($edited.firstParagraphFontSize -ne 14) { throw 'Microsoft Word does not read the edited 14pt font size.' }
  if ($edited.firstParagraphLineSpacingRule -ne 1) { throw 'Microsoft Word does not read the edited 1.5 line spacing.' }
  [ordered]@{ application = 'Microsoft Word'; version = $word.Version; passed = $true; documents = @($observations) } | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $resultPath -Encoding utf8
  Write-Output ('Word passed: text, headers, footers, ' + $edited.tables + ' table(s), ' + $edited.inlineImages + ' image(s), 14pt and 1.5 line spacing.')
} finally {
  if ($null -ne $document) { $document.Close(0); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($null -ne $word) { if ($ownsWord) { $word.Quit() }; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
}
