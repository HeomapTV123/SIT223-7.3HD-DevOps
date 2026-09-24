// Runs in the Windows Jenkins workspace after this build's successful Release.
env.MONITOR_TOOL_CONTAINER = "sit223-hd-monitor-tool-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
env.MONITOR_CONFIG_CONTAINER = "sit223-hd-monitor-config-${env.BUILD_TAG}".replaceAll('[^a-zA-Z0-9_.-]', '-')
dir('reports/monitoring') {
    deleteDir()
    writeFile file: 'monitoring-result.txt', text: 'Monitoring: NOT_COMPLETED\n'
    writeFile file: 'email-result.txt', text: 'Email delivery: NOT_TESTED\n'
    writeFile file: 'monitoring-context.txt', text: """Build: ${env.BUILD_NUMBER}
Commit: ${env.GIT_COMMIT}
Production image: ${env.APP_IMAGE_ID}
Prometheus: ${env.PROMETHEUS_IMAGE}
Alertmanager: ${env.ALERTMANAGER_IMAGE}
Grafana: ${env.GRAFANA_IMAGE}
Outage demonstration: ${params.VERIFY_MONITORING_ALERT}
"""
}
try {
    if (!fileExists('reports/release/release-result.txt') || !readFile('reports/release/release-result.txt').startsWith('Release: PASSED\n')) {
        error('Monitoring requires this build\'s successful Release report.')
    }
    // Refuse to replace unrelated containers using the reserved monitoring names.
    powershell '''
$ErrorActionPreference = 'Stop'
foreach ($name in @('sit223-hd-prometheus', 'sit223-hd-alertmanager', 'sit223-hd-grafana')) {
    $existing = docker ps -a --filter "name=^/$name$" --format '{{.ID}}'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect monitoring containers.' }
    if ($existing) {
        $container = (docker inspect $name | ConvertFrom-Json)[0]
        if ($LASTEXITCODE -ne 0 -or $container.Config.Labels.'com.docker.compose.project' -ne $env:MONITORING_PROJECT) {
            throw "Refusing to replace unrelated container $name."
        }
    }
}
'''
    bat 'docker compose --project-name %MONITORING_PROJECT% --file compose.monitoring.yaml config --quiet'
    bat 'docker compose --project-name %MONITORING_PROJECT% --file compose.monitoring.yaml config > reports/monitoring/compose-resolved.yaml'
    bat 'docker compose --project-name %MONITORING_PROJECT% --file compose.monitoring.yaml pull'
    bat 'docker image inspect %PROMETHEUS_IMAGE% %ALERTMANAGER_IMAGE% %GRAFANA_IMAGE% > reports/monitoring/monitor-images.json'
    bat '''@echo off
docker run --rm --name "%MONITOR_TOOL_CONTAINER%" --network none --read-only --tmpfs /tmp --cap-drop ALL --volume "%WORKSPACE%/monitoring:/etc/prometheus:ro" --entrypoint /bin/promtool "%PROMETHEUS_IMAGE%" check config /etc/prometheus/prometheus.yml > reports/monitoring/prometheus-config-check.txt 2>&1
'''
    bat '''@echo off
docker run --rm --name "%MONITOR_TOOL_CONTAINER%" --network none --read-only --tmpfs /tmp --cap-drop ALL --volume "%WORKSPACE%/monitoring:/etc/prometheus:ro" --entrypoint /bin/promtool "%PROMETHEUS_IMAGE%" test rules /etc/prometheus/alerts.test.yml > reports/monitoring/alert-rule-tests.txt 2>&1
'''
    bat 'docker volume create sit223-hd-monitoring_private-config'
    withEnv(["SMTP_SMARTHOST=${params.SMTP_SMARTHOST}", "SMTP_FROM=${params.SMTP_FROM ?: ''}", "ALERT_EMAIL_TO=${params.ALERT_EMAIL_TO}"]) {
        withCredentials([usernamePassword(credentialsId: 'monitoring-smtp', usernameVariable: 'SMTP_USERNAME', passwordVariable: 'SMTP_PASSWORD')]) {
            try {
                // Inherit credential variables by name. Never write their values to command text or artifacts.
                bat '''@echo off
docker run --rm --name "%MONITOR_CONFIG_CONTAINER%" --network none --user 0:0 --read-only --cap-drop ALL --cap-add CHOWN --security-opt no-new-privileges:true --env SMTP_SMARTHOST --env SMTP_FROM --env ALERT_EMAIL_TO --env SMTP_USERNAME --env SMTP_PASSWORD --volume "%WORKSPACE%/scripts:/checks:ro" --volume sit223-hd-monitoring_private-config:/private "%APP_IMAGE_ID%" node /checks/configure-monitoring.mjs /private
'''
            } finally {
                bat(returnStatus: true, script: '@docker rm -f "%MONITOR_CONFIG_CONTAINER%" >nul 2>&1')
            }
        }
    }
    bat '''@echo off
docker run --rm --name "%MONITOR_TOOL_CONTAINER%" --network none --read-only --tmpfs /tmp --cap-drop ALL --volume sit223-hd-monitoring_private-config:/etc/alertmanager/private:ro --entrypoint /bin/amtool "%ALERTMANAGER_IMAGE%" check-config /etc/alertmanager/private/alertmanager.yml > reports/monitoring/alertmanager-config-check.txt 2>&1
'''
    // Recreate services so that changes to files and SMTP settings take effect on every successful run.
    bat 'docker compose --project-name %MONITORING_PROJECT% --file compose.monitoring.yaml up -d --no-build --pull never --force-recreate --wait --wait-timeout 120'
    bat '''@echo off
docker run --rm --name "%MONITOR_TOOL_CONTAINER%" --network sit223-hd-monitoring_default --read-only --cap-drop ALL --security-opt no-new-privileges:true --volume "%WORKSPACE%/scripts:/checks:ro" "%APP_IMAGE_ID%" node /checks/check-monitoring.mjs ready > reports/monitoring/monitoring-ready.json
'''
    if (params.VERIFY_MONITORING_ALERT) {
        powershell '''
$ErrorActionPreference = 'Stop'
$container = (docker inspect $env:PRODUCTION_CONTAINER | ConvertFrom-Json)[0]
if ($LASTEXITCODE -ne 0 -or $container.Config.Labels.'com.docker.compose.project' -ne $env:PRODUCTION_PROJECT -or $container.Config.Labels.'com.docker.compose.service' -ne 'app' -or $container.Image -ne $env:APP_IMAGE_ID -or $container.State.Health.Status -ne 'healthy') {
    throw "Outage demonstration requires this build's healthy, owned production container."
}
$health = Invoke-RestMethod -Uri "$env:PRODUCTION_URL/health" -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.environment -ne 'production' -or $health.version -ne $env:APP_VERSION) { throw 'Production identity check failed.' }
'''
        boolean stopAttempted = false
        try {
            stopAttempted = true
            writeFile file: 'reports/monitoring/email-result.txt', text: 'Email delivery: IN_PROGRESS\nReal production outage demonstration requested.\n'
            bat 'docker stop --time 10 %PRODUCTION_CONTAINER%'
            bat '''@echo off
docker run --rm --name "%MONITOR_TOOL_CONTAINER%" --network sit223-hd-monitoring_default --read-only --cap-drop ALL --security-opt no-new-privileges:true --volume "%WORKSPACE%/scripts:/checks:ro" --volume "%WORKSPACE%/reports/monitoring:/reports:ro" "%APP_IMAGE_ID%" node /checks/check-monitoring.mjs firing /reports/monitoring-ready.json > reports/monitoring/alert-firing.json
'''
        } finally {
            // Recovery also runs after a failed SMTP attempt or failed monitoring check.
            if (stopAttempted) {
                bat 'docker start %PRODUCTION_CONTAINER%'
                writeFile file: 'reports/monitoring/production-recovery.txt', text: 'Recovery: NOT_COMPLETED\n'
                powershell '''
$ErrorActionPreference = 'Stop'
$deadline = (Get-Date).AddSeconds(90)
do {
    $container = (docker inspect $env:PRODUCTION_CONTAINER | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -ne 0 -or $container.Image -ne $env:APP_IMAGE_ID) { throw 'Production image changed during recovery.' }
    if ($container.State.Health.Status -eq 'healthy') {
        $health = Invoke-RestMethod -Uri "$env:PRODUCTION_URL/health" -TimeoutSec 10
        if ($health.status -ne 'ok' -or $health.environment -ne 'production' -or $health.version -ne $env:APP_VERSION) { throw 'Recovered production identity is incorrect.' }
        $health | ConvertTo-Json | Set-Content -Path 'reports/monitoring/recovered-health.json' -Encoding UTF8
        exit 0
    }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
throw 'Production did not become healthy within 90 seconds. Inspect Docker Desktop.'
'''
                writeFile file: 'reports/monitoring/production-recovery.txt', text: "Recovery: PASSED\nSame production image restarted and healthy: ${env.APP_IMAGE_ID}\n"
            }
        }
        bat '''@echo off
docker run --rm --name "%MONITOR_TOOL_CONTAINER%" --network sit223-hd-monitoring_default --read-only --cap-drop ALL --security-opt no-new-privileges:true --volume "%WORKSPACE%/scripts:/checks:ro" --volume "%WORKSPACE%/reports/monitoring:/reports:ro" "%APP_IMAGE_ID%" node /checks/check-monitoring.mjs resolved /reports/alert-firing.json > reports/monitoring/alert-resolved.json
'''
        writeFile file: 'reports/monitoring/email-result.txt', text: 'Email delivery: SMTP_ACCEPTED\nA real TaskboardDown alert fired and resolved. Alertmanager recorded a successful email request in each phase.\nConfirm both FIRING and RESOLVED messages arrived in the receiver mailbox; SMTP acceptance alone does not prove inbox delivery.\n'
    }
    writeFile file: 'reports/monitoring/monitoring-result.txt', text: "Monitoring: PASSED\nLive production target, alert rules, Alertmanager connection, Grafana dashboard and datasource passed.\nEmail demonstration: ${params.VERIFY_MONITORING_ALERT ? 'SMTP_ACCEPTED: verify mailbox receipt' : 'NOT_TESTED: enable VERIFY_MONITORING_ALERT for the demonstration'}\n"
    echo 'Monitoring is ready: Grafana http://localhost:3003, Prometheus http://localhost:9090, Alertmanager http://localhost:9093.'
} catch (failure) {
    writeFile file: 'reports/monitoring/monitoring-result.txt', text: "Monitoring: FAILED\nReason: ${failure.message}\nInspect the individual checks, email-result.txt and production-recovery.txt if present.\n"
    if (params.VERIFY_MONITORING_ALERT) {
        writeFile file: 'reports/monitoring/email-result.txt', text: 'Email demonstration: NOT_VERIFIED\nSee monitoring-result.txt, alert-firing.json, alert-resolved.json and production-recovery.txt when present.\n'
    }
    throw failure
} finally {
    bat(returnStatus: true, script: '@docker rm -f "%MONITOR_TOOL_CONTAINER%" >nul 2>&1')
    bat(returnStatus: true, script: '@docker compose --project-name %MONITORING_PROJECT% --file compose.monitoring.yaml ps --all > reports/monitoring/monitoring-services.txt 2>&1')
    bat(returnStatus: true, script: '@docker compose --project-name %MONITORING_PROJECT% --file compose.monitoring.yaml logs --no-color --tail 100 > reports/monitoring/monitoring-services.log 2>&1')
}
