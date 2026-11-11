# Runs without Pester and never invokes a real DSH installation.
$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path -Parent $PSScriptRoot) 'install.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Get-HarnessProcesses', 'Resolve-DshCandidate', 'Get-HarnessInstallLocations', 'Find-DshExecutable', 'Test-ValidProfileName', 'Get-ProfileNames', 'Get-ProfileFromArguments', 'Get-DetectedProfile')) {
  $functionAst = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $functionAst) { throw "Missing function: $name" }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}
$realLocations = ${function:Get-HarnessInstallLocations}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('fujiang-install-test-' + [guid]::NewGuid().ToString('N'))
$oldDshHome = $env:DSH_HOME
$oldDshProfile = $env:DSH_PROFILE
$oldPath = $env:PATH
# A DSH_PROFILE exported by the surrounding tooling would override every fixture.
$env:DSH_PROFILE = $null
$testCount = 0
function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -ne $Expected) { throw "$Message : expected [$Expected], got [$Actual]" }
  $script:testCount++
  Write-Host "PASS $Message"
}
try {
  $installRoot = Join-Path $fixture '应用 [测试]\Custom App Folder'
  $cliDir = Join-Path $installRoot 'resources\runtime\cli\bin'
  [void][IO.Directory]::CreateDirectory($cliDir)
  $cli = Join-Path $cliDir 'dsh.cmd'
  [IO.File]::WriteAllText($cli, '@exit /b 91')
  $appExe = Join-Path $installRoot 'DeepSeek Harness.exe'
  [IO.File]::WriteAllBytes($appExe, [byte[]]@())

  Assert-Equal (Resolve-DshCandidate -Path $installRoot) $cli 'install folder with spaces, Chinese and brackets'
  Assert-Equal (Resolve-DshCandidate -Path $appExe) $cli 'Desktop executable resolves adjacent bundled CLI'
  Assert-Equal (Find-DshExecutable -Command ('"' + $cli + '"')) $cli 'quoted literal CLI path'
  Assert-Equal (Find-DshExecutable -Command $installRoot) $cli 'explicit install directory'
  Assert-Equal (Find-DshExecutable -Command $appExe) $cli 'explicit Desktop executable'

  # Simulate an installation on a different drive without changing disk contents.
  $driveName = 'FJTest'
  if (Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue) { throw 'Test drive already exists.' }
  New-PSDrive -Name $driveName -PSProvider FileSystem -Root $fixture | Out-Null
  try {
    $otherDrive = $driveName + ':\应用 [测试]\Custom App Folder'
    Assert-Equal (Find-DshExecutable -Command $otherDrive) $cli 'non-C provider drive resolves bundled CLI'
  } finally { Remove-PSDrive -Name $driveName }

  # An invalid explicit path must not fall back to an installed default.
  function Get-HarnessInstallLocations { $installRoot }
  Assert-Equal (Find-DshExecutable -Command (Join-Path $fixture 'missing\dsh.cmd')) $null 'bad explicit path does not select another install'
  Assert-Equal (Find-DshExecutable) $cli 'automatic discovered custom location'

  # Exercise actual registry interpretation with deterministic fixture records.
  function Get-HarnessProcesses { @() }
  function Get-ItemProperty {
    param($Path, $ErrorAction)
    if ($Path -eq 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*') {
      [pscustomobject]@{ DisplayName='DeepSeek Harness'; InstallLocation=$installRoot; DisplayIcon=('"' + $appExe + '",0') }
      [pscustomobject]@{ DisplayName='Other App'; InstallLocation='IGNORED'; DisplayIcon='IGNORED' }
    }
    if ($Path -eq 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\*') {
      [pscustomobject]@{ PSChildName='DeepSeek Harness.exe'; '(default)'=$appExe }
    }
  }
  $locations = @(& $realLocations)
  Assert-Equal ($locations -contains $installRoot) $true 'uninstall registry custom InstallLocation'
  Assert-Equal (@($locations | Where-Object { $_ -eq $appExe }).Count -ge 2) $true 'quoted DisplayIcon index and App Paths default value'
  Assert-Equal ($locations -contains 'IGNORED') $false 'unrelated installed applications ignored'
  Remove-Item Function:\Get-ItemProperty

  function Get-HarnessInstallLocations { Join-Path $fixture 'stale-registration' }
  $env:PATH = $cliDir
  Assert-Equal (Find-DshExecutable) $cli 'PATH fallback when registration is stale'
  Assert-Equal (Find-DshExecutable -Command 'dsh.cmd') $cli 'explicit command name resolved from PATH'
  $env:PATH = $oldPath

  # Run the real top-level installer only in DryRun mode against a fake profile.
  $dataRoot = Join-Path $fixture '移动的数据目录\.dsh'
  $profileDir = Join-Path $dataRoot 'profiles\desktop'
  [void][IO.Directory]::CreateDirectory($profileDir)
  [IO.File]::WriteAllText((Join-Path $profileDir 'package.json'), '{}')
  $output = (& $installer -DryRun -PromptForDshPath -DshCommand $installRoot -DshHome $dataRoot 6>&1 | Out-String -Width 4096)
  Assert-Equal ($output.Contains($cli)) $true 'DryRun reports selected custom installation'
  Assert-Equal ($output.Contains($dataRoot)) $true 'explicit data directory is independent of app directory'
  Assert-Equal (Test-Path -LiteralPath (Join-Path $dataRoot 'local-plugins')) $false 'DryRun never copies plugin files'
  $env:DSH_HOME = $dataRoot
  $output = (& $installer -DryRun -DshCommand $installRoot 6>&1 | Out-String -Width 4096)
  Assert-Equal ($output.Contains($dataRoot)) $true 'existing DSH_HOME is honored'

  $failed = $false
  try { & $installer -DryRun -PromptForDshPath -DshCommand (Join-Path $fixture 'missing') -DshHome $dataRoot } catch {
    $failed = $_.Exception.Message.Contains('-DshCommand') -and $_.Exception.Message.Contains('-DshHome')
  }
  Assert-Equal $failed $true 'missing installation reports both path options without prompting in DryRun'
  # Full flow against a harmless fake CLI and miniature bundle, never the real app.
  $bundle = Join-Path $fixture 'fixture-bundle'
  [void][IO.Directory]::CreateDirectory((Join-Path $bundle 'plugin'))
  Copy-Item -LiteralPath $installer -Destination (Join-Path $bundle 'install.ps1')
  [IO.File]::WriteAllText((Join-Path $bundle 'plugin\package.json'), '{"name":"test-only-plugin","version":"0.0.0"}')
  # The requested profile has to exist; dsh is not asked to seed a brand-new one here.
  [void][IO.Directory]::CreateDirectory((Join-Path $dataRoot 'profiles\test'))
  [IO.File]::WriteAllText((Join-Path $dataRoot 'profiles\test\package.json'), '{}')
  $invocationLog = Join-Path $fixture 'cli-arguments.txt'
  $fakeCli = Join-Path $fixture 'fake-dsh.ps1'
  [IO.File]::WriteAllText($fakeCli, ('$args | Set-Content -LiteralPath ''' + $invocationLog.Replace("'", "''") + ''' -Encoding UTF8' + "`r`n" + '$global:LASTEXITCODE = 0'))
  # Bypass the running-app guard only inside the miniature test fixture.
  $fixtureInstaller = Join-Path $bundle 'install.ps1'
  $fixtureText = [IO.File]::ReadAllText($fixtureInstaller)
  $fixtureAst = [Management.Automation.Language.Parser]::ParseInput($fixtureText, [ref]$null, [ref]$null)
  $processFunction = $fixtureAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-HarnessProcesses' }, $true)
  $fixtureText = $fixtureText.Remove($processFunction.Extent.StartOffset, $processFunction.Extent.EndOffset - $processFunction.Extent.StartOffset).Insert($processFunction.Extent.StartOffset, 'function Get-HarnessProcesses { @() }')
  [IO.File]::WriteAllText($fixtureInstaller, $fixtureText, (New-Object Text.UTF8Encoding($true)))
  & $fixtureInstaller -Profile test -DshCommand $fakeCli -DshHome $dataRoot | Out-Null
  $cliArguments = @(Get-Content -LiteralPath $invocationLog -Encoding UTF8)
  Assert-Equal ($cliArguments -join '|') ('plugin|--profile|test|add|' + (Join-Path $dataRoot 'local-plugins\dsh-prompt-custom')) 'isolated install passes custom data path as one argument'
  Assert-Equal (Test-Path -LiteralPath (Join-Path $dataRoot 'local-plugins\dsh-prompt-custom\package.json')) $true 'isolated install copies only fixture plugin'

  # Profile auto-detection: a web profile must win over a bare desktop folder.
  $autoRoot = Join-Path $fixture 'auto-profile\.dsh'
  $webDir = Join-Path $autoRoot 'profiles\web'
  $deskDir = Join-Path $autoRoot 'profiles\desktop'
  [void][IO.Directory]::CreateDirectory((Join-Path $webDir 'node_modules'))
  [void][IO.Directory]::CreateDirectory($deskDir)
  [IO.File]::WriteAllText((Join-Path $webDir 'package.json'), '{"name":"dsh-profile-web"}')
  [IO.File]::WriteAllText((Join-Path $deskDir 'package.json'), '{"name":"dsh-profile-desktop"}')
  Assert-Equal ((@(Get-DetectedProfile $autoRoot)) -join '|') 'web|profile with installed dependencies' 'installed web profile wins over bare desktop folder'

  # dsh-process.json records the profile actually launched.
  $procRoot = Join-Path $fixture 'proc-profile\.dsh'
  [void][IO.Directory]::CreateDirectory((Join-Path $procRoot 'profiles\web'))
  [void][IO.Directory]::CreateDirectory((Join-Path $procRoot 'profiles\desktop\node_modules'))
  [IO.File]::WriteAllText((Join-Path $procRoot 'profiles\web\package.json'), '{"name":"dsh-profile-web"}')
  [IO.File]::WriteAllText((Join-Path $procRoot 'profiles\desktop\package.json'), '{"name":"dsh-profile-desktop"}')
  [IO.File]::WriteAllText((Join-Path $procRoot 'dsh-process.json'), '{"pid":31356,"argv":["C:\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js","web","--no-open"]}')
  Assert-Equal ((@(Get-DetectedProfile $procRoot)) -join '|') 'web|dsh-process.json' 'dsh-process.json argv beats the installed-dependency hint'
  Assert-Equal (Get-ProfileFromArguments @('--profile', 'tui')) 'tui' 'explicit --profile pair'
  Assert-Equal (Get-ProfileFromArguments @('--profile=headless')) 'headless' 'explicit --profile=value form'
  Assert-Equal (Get-ProfileFromArguments @('--dump-config')) $null 'no profile token yields null'
  Assert-Equal (Test-ValidProfileName '../../etc') $false 'path traversal in a profile name is rejected'

  # DSH_PROFILE wins over everything except an explicit -Profile.
  $env:DSH_PROFILE = 'desktop'
  Assert-Equal ((@(Get-DetectedProfile $procRoot)) -join '|') 'desktop|DSH_PROFILE environment variable' 'DSH_PROFILE environment variable is honored'
  $env:DSH_PROFILE = $null

  # An unknown profile fails with the list of available ones.
  $profileFailure = ''
  try { & $installer -Profile tui -DshCommand $installRoot -DshHome $autoRoot } catch { $profileFailure = $_.Exception.Message }
  Assert-Equal ($profileFailure.Contains('tui') -and $profileFailure.Contains('web')) $true 'missing profile reports the requested name and available ones'

  Write-Host "Passed $testCount installer path checks on PowerShell $($PSVersionTable.PSVersion)."
} finally {
  $env:DSH_HOME = $oldDshHome
  $env:DSH_PROFILE = $oldDshProfile
  $env:PATH = $oldPath
  $resolvedFixture = [IO.Path]::GetFullPath($fixture)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedFixture) -notlike 'fujiang-install-test-*') {
    throw 'Refusing to remove an unexpected fixture path.'
  }
  Remove-Item -LiteralPath $resolvedFixture -Recurse -Force -ErrorAction SilentlyContinue
}

