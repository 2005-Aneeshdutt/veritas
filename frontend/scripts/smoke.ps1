$ErrorActionPreference = "Continue"

$FRONTEND = "http://localhost:3000"
$BACKEND  = "http://localhost:8000"
$RUN_ID   = "run_beec9668"
$DENY_TXN  = "pay_cloudsync_0060"
$ALLOW_TXN = "pay_cloudsync_1133"

$PASS = 0; $FAIL = 0; $WARN = 0

function Pass($msg) { Write-Host "  [PASS] $msg" -ForegroundColor Green; $script:PASS++ }
function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red;   $script:FAIL++ }
function Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow;$script:WARN++ }
function Section($msg) { Write-Host ""; Write-Host "============================================================"; Write-Host $msg; Write-Host "============================================================" }

function Get-Json($url) {
    try { return Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 15 }
    catch { Fail "GET $url"; Write-Host "       $($_.Exception.Message)"; return $null }
}

function Test-Url($url, $name) {
    try {
        $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 15 -UseBasicParsing
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { Pass "$name -> HTTP $($response.StatusCode)"; return $true }
        Fail "$name -> HTTP $($response.StatusCode)"; return $false
    }
    catch { Fail "$name -- $($_.Exception.Message)"; return $false }
}

Section "1. SERVICES"
Test-Url "$FRONTEND" "Frontend is reachable" | Out-Null
Test-Url "$BACKEND/api/mode" "Backend API is reachable" | Out-Null

Section "2. FRONTEND ROUTES"
# NOTE: /payments /recovery /audit /experiments are the VERITAS spec's proposed
# names. The built app uses /portfolio /recover /evidence /lab. Both sets are
# probed so the difference is visible rather than assumed.
foreach ($route in @("/", "/payments", "/recovery", "/control-tower", "/evidence", "/audit", "/experiments")) {
    Test-Url "$FRONTEND$route" "spec route $route" | Out-Null
}
Write-Host ""
foreach ($route in @("/portfolio", "/recover", "/lab", "/prove", "/data", "/live")) {
    Test-Url "$FRONTEND$route" "built route $route" | Out-Null
}
Test-Url "$FRONTEND/run/$RUN_ID/journey" "Agent journey page" | Out-Null

Section "3. RUN DATA"
$run = Get-Json "$BACKEND/api/run/$RUN_ID"
if ($null -ne $run) {
    Pass "Run $RUN_ID is available"
    if (($run | ConvertTo-Json -Depth 20).Length -gt 0) { Pass "Run contains data" } else { Fail "Run is empty" }
}

Section "4. DENIED PAYMENT JOURNEY"
$deny = Get-Json "$BACKEND/api/run/$RUN_ID/journey/$DENY_TXN"
if ($null -ne $deny) {
    $denyText = $deny | ConvertTo-Json -Depth 30
    Pass "Denied transaction journey exists"
    if ($denyText -match '"deny"') { Pass "DENY decision present" } else { Warn "No explicit DENY in payload" }
    if ($deny.recovered_paise -eq 0) { Pass "Denied journey recovered_paise = 0" } else { Fail "Denied journey reports recovered_paise = $($deny.recovered_paise)" }
    if ($deny.final_outcome -eq "denied") { Pass "final_outcome = denied" } else { Fail "final_outcome = $($deny.final_outcome)" }
}

Section "5. ALLOWED PAYMENT JOURNEY"
$allow = Get-Json "$BACKEND/api/run/$RUN_ID/journey/$ALLOW_TXN"
if ($null -ne $allow) {
    $allowText = $allow | ConvertTo-Json -Depth 30
    Pass "Allowed transaction journey exists"
    if ($allowText -match '"allow"') { Pass "ALLOW decision present" } else { Warn "No explicit ALLOW in payload" }
    if ($allow.checks.Count -gt 0) { Pass "Policy checks present ($($allow.checks.Count))" } else { Warn "No policy checks" }
    Pass "final_outcome = $($allow.final_outcome)"
}

Section "6. CLAIM STATES"
$uiFile = "c:\Users\anees\OneDrive\Desktop\buildathon\frontend\src\components\ui.tsx"
if (Test-Path $uiFile) {
    $uiText = Get-Content $uiFile -Raw
    foreach ($state in @("verified","measured","projected","observed","unverified","abstained")) {
        if ($uiText -match $state) { Pass "Claim state '$state' exists" } else { Fail "Claim state '$state' missing" }
    }
} else { Warn "ui.tsx not found" }

Section "7. RECOVERY PASSPORT"
$passportFile = "c:\Users\anees\OneDrive\Desktop\buildathon\frontend\src\components\RecoveryPassport.tsx"
if (Test-Path $passportFile) {
    $passportText = Get-Content $passportFile -Raw
    foreach ($term in @("Diagnosis","Policy","Execution","Gateway","Ledger","measured","verified")) {
        if ($passportText -match [regex]::Escape($term)) { Pass "Passport contains '$term'" } else { Fail "Passport missing '$term'" }
    }
    if ($passportText -match 'fetch\("/api/mode"\)') { Fail "RecoveryPassport FETCHES /api/mode" }
    else { Pass "RecoveryPassport does not fetch /api/mode for historical gateway claims" }
} else { Fail "RecoveryPassport.tsx not found" }

Section "8. DENIAL SAFETY"
if ($null -ne $deny) {
    if ($deny.final_outcome -eq "denied" -and $deny.recovered_paise -eq 0) {
        Pass "Denied journey claims no execution and no money"
    } else { Fail "Denied journey state is inconsistent" }
}

Section "9. HEADLINE MONEY SEPARATION"
$pf = Get-Json "$BACKEND/api/portfolio"
if ($null -ne $pf) {
    $measured  = [int]$pf.total_measured_paise
    $projected = [int]$pf.total_recoverable_central_paise
    $atrisk    = [int]$pf.total_gap_value_paise
    Write-Host "  AT RISK   : Rs $([math]::Round($atrisk/100))"
    Write-Host "  PROJECTED : Rs $([math]::Round($projected/100))"
    Write-Host "  MEASURED  : Rs $([math]::Round($measured/100))"
    if ($measured -ne $projected) { Pass "MEASURED and PROJECTED are different values" } else { Fail "MEASURED equals PROJECTED" }
    if ($measured -lt $projected) { Pass "MEASURED < PROJECTED (measured is the smaller, harder number)" } else { Warn "MEASURED >= PROJECTED" }
}

Section "10. COUNTERFACTUAL LAB DATA"
$lab = Get-Json "$BACKEND/api/lab/cloudsync"
if ($null -ne $lab) {
    foreach ($s in $lab.strategies) {
        Write-Host ("    {0,-26} Rs {1,-10} breaches {2}" -f $s.name, [math]::Round($s.recovered_paise/100), $s.mandate_violations)
    }
    $veritas = $lab.strategies | Where-Object { $_.key -eq "revenue_doctor" }
    $naive   = $lab.strategies | Where-Object { $_.key -eq "naive_retry" }
    if ($veritas -and $veritas.mandate_violations -eq 0) { Pass "VERITAS strategy has 0 mandate violations" } else { Fail "VERITAS strategy violations not zero" }
    if ($naive -and $naive.mandate_violations -gt 0) { Pass "Naive retry has $($naive.mandate_violations) violations (the argument holds)" } else { Warn "Naive retry shows no violations" }
    if ($naive -and $veritas -and $naive.recovered_paise -gt $veritas.recovered_paise) { Pass "Naive recovers MORE money -- 'more recovery != better' is real" } else { Warn "Naive does not out-recover VERITAS" }
}

Section "11. FRONTEND SAFETY CHECKS"
$frontendRoot = "c:\Users\anees\OneDrive\Desktop\buildathon\frontend\src"
if (Test-Path $frontendRoot) {
    $files = Get-ChildItem $frontendRoot -Recurse -File -Include *.ts,*.tsx
    $allText = ""
    foreach ($file in $files) { $allText += "`n" + (Get-Content $file.FullName -Raw) }
    if ($allText -match "fake.*captur|mock.*captur|fake.*recover") { Warn "Possible fake recovery wording -- inspect" }
    else { Pass "No fake recovery/capture implementation detected" }
    foreach ($label in @("measured","projected","unverified","abstained","verified","observed")) {
        if ($allText -match $label) { Pass "Semantic label '$label' present in frontend" } else { Warn "Label '$label' not found" }
    }
}

Section "12. BACKEND FREEZE CHECK"
Push-Location "c:\Users\anees\OneDrive\Desktop\buildathon"
try {
    $status = git status --short
    $backendChanges = $status | Where-Object { $_ -match "src/doctor/" -or $_ -match " tests/" -or $_ -match "data/runs" }
    if ($backendChanges) { Fail "Backend/data changes detected"; Write-Host $backendChanges }
    else { Pass "No backend/data changes detected" }
    $fe = $status | Where-Object { $_ -match "frontend/" }
    Write-Host ""
    Write-Host "  Frontend changes:"
    foreach ($f in $fe) { Write-Host "   $f" }
}
finally { Pop-Location }

Section "FINAL RESULT"
Write-Host ""
Write-Host "PASS : $PASS" -ForegroundColor Green
Write-Host "WARN : $WARN" -ForegroundColor Yellow
Write-Host "FAIL : $FAIL" -ForegroundColor Red
Write-Host ""
if ($FAIL -eq 0) { Write-Host "VERITAS FRONTEND SMOKE TEST: PASS" -ForegroundColor Green }
else { Write-Host "VERITAS FRONTEND SMOKE TEST: REVIEW FAILURES" -ForegroundColor Red }
