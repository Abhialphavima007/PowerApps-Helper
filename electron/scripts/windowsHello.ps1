param([ValidateSet('availability', 'verify')][string]$Mode = 'verify')

$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $verifier = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
    Select-Object -First 1
  if (-not $asTask) { throw 'Windows Hello async runtime is unavailable.' }

  function Await-WinRt($operation, $resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    return $task.GetAwaiter().GetResult().ToString()
  }

  $availabilityType = [Windows.Security.Credentials.UI.UserConsentVerifierAvailability, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]
  $availability = Await-WinRt ($verifier::CheckAvailabilityAsync()) $availabilityType
  if ($Mode -eq 'availability') { Write-Output $availability; exit 0 }
  if ($availability -ne 'Available') { Write-Output $availability; exit 2 }

  $resultType = [Windows.Security.Credentials.UI.UserConsentVerificationResult, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]
  $result = Await-WinRt ($verifier::RequestVerificationAsync('Verify your Windows identity to reveal a PowerApps Helper credential')) $resultType
  Write-Output $result
  if ($result -eq 'Verified') { exit 0 }
  exit 2
} catch {
  Write-Output ('Error: ' + $_.Exception.Message)
  exit 1
}
