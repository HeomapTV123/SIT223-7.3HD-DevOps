# SIT223 HD Task Manager

Taskboard is a small application for the SIT223 7.3HD Jenkins DevOps task. It provides real features that can be built, tested, deployed and monitored: task creation, editing, completion, deletion, searching, filtering and database persistence.

The Jenkinsfile now includes **Build, Test, Code Quality, and Security**. Windows Jenkins build #3 passed the first three stages, including all 37 tests, coverage import, and the SonarQube Cloud quality gate. Security is prepared with Trivy and needs its first Windows Jenkins run. The full assessment still needs Deploy, Release, and Monitoring with automatic notifications, followed by the demonstration video and report.

## Start here on Windows

Requirements already checked on your computer: Node.js 24.11.0, Git, Docker Desktop with a working Linux engine, and Jenkins that can run a Docker container. Keep Docker Desktop running.

1. Extract the ZIP. Open the `sit223-hd-task-manager` folder containing `package.json` and `compose.yaml`.
2. Click the File Explorer address bar, type `cmd`, and press Enter. The Command Prompt opens in this folder.
3. Run the application tests:

```cmd
npm test
```

The expected result is **37 tests, 37 passed, 0 failed**. Node.js 24.11 may print an experimental warning for its built-in SQLite module; the test exit status and final summary determine the result. No third-party npm packages are required by this application.

4. Build and start the development container:

```cmd
docker compose up --build -d
docker compose ps
```

The first build downloads the Node.js base image. The application should eventually show `healthy` in the status column. Open [Taskboard](http://localhost:3000) in your browser.

5. Add a task, change its status, edit its title and refresh the page. Your task should remain saved. Check [health](http://localhost:3000/health) and [metrics](http://localhost:3000/metrics) as well.

If startup fails, capture the command output and run:

```cmd
docker compose logs --tail=80 app
```

To stop this development application while preserving its stored tasks:

```cmd
docker compose down
```

To start it again:

```cmd
docker compose up -d
```

## Application features

- Create tasks with a title, notes, priority and optional due date.
- Edit task details and move tasks between Open, In progress and Done.
- Search titles and notes, and combine status and priority filters.
- View totals by status and a count of overdue unfinished tasks. Overdue calculations use the UTC calendar date.
- Delete tasks after confirmation.
- Keep tasks in SQLite, stored in a named Docker volume outside the container's writable layer.
- Expose health, release information, request metrics, memory use and task counts.

The interface starts with an empty database. It does not contain fabricated assessment results or pre-filled demonstration tasks.

## Technologies and project files

The application uses Node.js 24 and its built-in HTTP server, SQLite module and test runner. The browser uses plain HTML, CSS and JavaScript. Docker packages the application, and Jenkins will automate its delivery.

| File or directory | Purpose |
| --- | --- |
| `src/server.js` | Starts the server and handles shutdown. |
| `src/app.js` | HTTP routes, request handling, response headers and JSON logging. |
| `src/store.js` | SQLite storage, CRUD operations, filters and statistics. |
| `src/validation.js` | Validation of task fields, dates, IDs and filters. |
| `src/metrics.js` | Prometheus text-format metrics with fixed route labels. |
| `public/` | Browser interface. |
| `test/` | 37 automated validation, storage and HTTP integration tests. |
| `scripts/ci-report.js` | Runs tests with coverage thresholds and writes JUnit and LCOV reports. |
| `scripts/healthcheck.js` | Checks that the running application and database are ready. |
| `Dockerfile` | Defines separate test and runtime images from a common base. |
| `compose.yaml` | Runs the local development application with persistent storage. |
| `Jenkinsfile` | Build, Test, Code Quality, and Security automation for Windows Jenkins. |
| `sonar-project.properties` | SonarQube Cloud project identifiers, source scope, coverage import, and quality-gate settings. |
| `ci/secrets-report.tpl` | Produces a secret-scan report containing locations and rule details without secret values or source snippets. |

## How to run tests with reports

```cmd
npm run test:ci
```

This command runs the same tests and produces:

- `reports/junit.xml`: test results suitable for Jenkins' JUnit plugin.
- `reports/lcov.info`: coverage data imported by the Code Quality stage.

The coverage thresholds are 85% lines, 75% branches and 85% functions. A test or threshold failure returns a nonzero exit code so the pipeline can stop.

Coverage is scoped to the four backend modules `app.js`, `store.js`, `validation.js` and `metrics.js`. It excludes the startup entry point, frontend JavaScript and helper scripts. Backend coverage therefore does not describe the entire application's test coverage. Startup and browser behaviour need separate checks.

The automated tests check real behaviour, including task lifecycles, combined filters, incorrect input, persistence after reopening SQLite, SQL-looking input, browser security headers, cross-origin rejection, health failures and the metrics response.

## How the Docker images work

The `base` stage copies the backend and browser assets. The `test` target adds the tests and report script. The `runtime` target runs the application as the non-root `node` user and includes a health check. The runtime image does not include the test directory.

The default base image is `node:24-bookworm-slim`. Its exact digest can change as Node.js publishes updates. For the final assessed build, record the resulting image ID and base-image digest; a digest can also be supplied using the `NODE_IMAGE` build argument when reproducible rebuilding is required.

The Compose service publishes the application only on `127.0.0.1:3000`. Its root filesystem is read-only; the SQLite directory is writable through the named volume. This is a local coursework application without user authentication.

Optional direct development run, when the Docker application is stopped:

```cmd
npm start
```

This uses `data/tasks.db` in the project folder. It is a different database from the Docker volume. Use Ctrl+C to stop it.

## Jenkins pipeline

Use the included Jenkinsfile after this folder has been committed to your own GitHub repository. Configure the new job as **Pipeline script from SCM**, with Git as SCM and `Jenkinsfile` as the script path. Jenkins checks out the repository automatically. The JUnit plugin must be installed to publish the test results.

This Jenkinsfile defines four assessed stages:

1. **Build** creates a runtime image tagged with the Jenkins build number, stores it in the local Docker image store and archives its metadata.
2. **Test** builds the test image, runs the tests in a container, copies the reports into the Jenkins workspace and publishes them. Tests or coverage failures fail the stage. The temporary test container is removed afterward.
3. **Code Quality** runs SonarScanner in Docker, imports the LCOV report, submits analysis to SonarQube Cloud and waits for the quality gate. A rejected gate, processing timeout, authentication failure or scanner error fails the stage. The scanner container is removed afterward, and any generated analysis-task metadata and scanner-image metadata are archived.
4. **Security** runs Trivy against an exported copy of the runtime image and scans the checked-out source for secret patterns. It records all vulnerability severities and fails on any HIGH/CRITICAL image vulnerability or any detected source secret. Reports are archived even on failure. Scanner errors and missing reports also fail the stage.

Each runtime image has `APP_VERSION` set to its build identifier. The app displays that value and exposes it through `/health` and `/api/info` so a later deployment can be matched to the build that produced it.

This pipeline uses `bat` because the Jenkins executor is Windows, even though the containers themselves run Linux. Build #3 checked out commit `23e177ec533ffdd39df9a8e499a07c91ed07182e`, built `sit223-hd-task-manager:build-3`, passed all 37 tests, and reported `QUALITY GATE STATUS: PASSED` and `Finished: SUCCESS`. Run the updated pipeline to verify Security. The overall timeout is 30 minutes to allow the first scanner and vulnerability-database downloads.

## Configure SonarQube Cloud

The configuration targets organization `heomaptv123`, project `HeomapTV123_SIT223-7.3HD-DevOps`, and the EU service at `https://sonarcloud.io`.

1. Open the project's [Analysis Method page](https://sonarcloud.io/project/configuration/AutoScan?id=HeomapTV123_SIT223-7.3HD-DevOps). Under **Administration > Analysis Method**, turn **Automatic Analysis off** so Jenkins can submit CI analysis.
2. In SonarQube Cloud, open **My account > Access Tokens > Personal Tokens**. Generate a token for Jenkins with an expiry covering the assessment period. The account must be allowed to execute analysis for this project.
3. In Jenkins, open **Manage Jenkins > Credentials > System > Global credentials (unrestricted) > Add Credentials**. Choose **Secret text**, scope **Global**, paste the token into **Secret**, and set the ID to **`sonarcloud-token`**. Keep the token out of source files, commands, screenshots and chat.
4. Confirm that the Jenkins **Credentials Binding** plugin is installed and enabled. The existing Git, Pipeline and JUnit plugins are also used. This Docker scanner setup does not require a separate SonarQube Jenkins plugin or a scanner installation on Windows.
5. Configure the Jenkins job to load `Jenkinsfile` from `*/main`. After these changes are merged to `main`, keep Docker Desktop running and select **Build Now**.

The first run downloads the official scanner image `sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0`. Its release tag is pinned in the Jenkinsfile and its image metadata is archived for traceability. The Windows workspace is mounted at `/usr/src` inside the scanner container; LCOV entries such as `SF:src/app.js` resolve against that directory. Jenkins supplies `SONAR_TOKEN` only while running the scanner, and Docker inherits it by environment-variable name.

`sonar.qualitygate.wait=true` makes the scanner poll SonarQube Cloud for up to 300 seconds after submission. A failed gate or timeout returns an error to Jenkins, blocking later stages. The connection is outbound from Jenkins, so this setup works with local Jenkins without a public webhook endpoint. The source revision is passed from Jenkins' Git checkout to identify the scanned commit. `sonar.projectVersion=1.0.0` is the application version, kept stable across CI builds; update it when preparing a new application release rather than on every build.

Static analysis covers `src`, `public` and `scripts`, with `test` classified as test code. The existing coverage report measures four backend modules. Uncovered frontend, bootstrap and helper code remains visible in SonarQube's overall coverage, so it will differ from the backend-only coverage printed by the Test stage. No source files or quality rules are excluded to force a passing gate.

For assessment evidence, keep the Jenkins **Code Quality** output, the matching [SonarQube Cloud dashboard](https://sonarcloud.io/dashboard?id=HeomapTV123_SIT223-7.3HD-DevOps), quality-gate conditions and representative findings. A first analysis can establish a new-code baseline; inspect overall-code issues and coverage as well as the gate status. A successful upload by itself is not evidence that the quality gate passed.

If the stage fails:

- **Missing credential:** create a Secret text credential with the exact ID `sonarcloud-token`.
- **Not authorized:** check the token expiry and the account's permission to analyse this project.
- **Automatic analysis conflict:** turn Automatic Analysis off on the project's Analysis Method page.
- **Quality gate failed:** open the dashboard, inspect the failing conditions, fix the code or add meaningful tests, commit and rerun.
- **Connection or timeout error:** check Docker Desktop and network connectivity, then retry and preserve the actual outcome.

## Run the Security stage

Security uses the official `aquasec/trivy:0.74.0` Docker image. No additional Jenkins credential, Trivy account, or Windows scanner installation is needed. Docker Desktop must be running, and Jenkins needs outbound access to Docker Hub and Trivy's vulnerability-database registries. The first scan downloads a database; a named volume, `sit223-hd-trivy-cache`, retains the cache for later runs. Trivy checks database freshness when scanning; the pipeline does not skip database updates.

After the Security changes are merged into `main`, select **Build Now** in the existing Jenkins job. Open **Console Output** and inspect the fourth stage. The source is mounted read-only in Trivy, and its reports are written to a separate writable mount. The SonarQube token is scoped to the earlier Code Quality stage and is not passed to Trivy.

The image scan uses `docker image save` to export the same runtime image created by Build, then scans that archive using `trivy image --input`. This works with the Linux engine behind Windows Docker Desktop without sharing its Docker socket with the scanner. The temporary archive is removed in cleanup and is not archived as a Jenkins report.

### Scope and policy

| Check | Scope | Blocking rule |
| --- | --- | --- |
| Image vulnerabilities | OS packages and supported language packages detected in the runtime image, including the base image | Any HIGH or CRITICAL vulnerability, even if no fixed version is available |
| Source secrets | Current checked-out files inspected with Trivy's built-in secret rules | Any reported secret, at any severity |
| Scanner health | Scan commands, report creation, and report conversion | Command failure, timeout, malformed input, or missing required report |

The full image JSON and text reports include UNKNOWN, LOW, MEDIUM, HIGH, and CRITICAL results. The gate reads that same JSON, rather than performing a second vulnerability scan with a potentially different database. The collection command's `--exit-code 0` allows the complete report to be generated; the subsequent mandatory gate uses `--severity HIGH,CRITICAL --exit-code 10` and fails Jenkins when those findings exist. There is no `--ignore-unfixed` filter or CVE suppression file in this change.

The source scan skips generated reports, coverage, database data, installed modules, `.scannerwork`, and Git metadata. Trivy's built-in allowed paths and binary/lock-file skip patterns also apply. This checks the current working tree, not deleted secrets in Git history. `ci/secrets-report.tpl` reports only file path, rule ID, severity, and line number; it does not print matched secret values or surrounding source lines. A clean scan means no configured patterns were detected in that scope.

This application has no third-party npm dependencies, so `npm audit` alone would have very little scope. Scanning the built image also assesses the packaged operating system and supported packages shipped with the runtime. These checks complement the functional tests and SonarQube analysis.

### Reports and evidence

Open the Jenkins build's **Artifacts** and find `reports/security/`:

| Report | Purpose |
| --- | --- |
| `scan-context.txt` | Build number, source commit, application image tag, scanner tag, and policy |
| `scanner-image.json` | Docker metadata identifying the scanner image that actually ran |
| `trivy-image.json` | Full machine-readable vulnerability results |
| `trivy-image.txt` | Readable report across all severities |
| `trivy-image-gate.txt` | HIGH/CRITICAL results used to block the pipeline |
| `trivy-secrets.txt` | Secret finding locations, with values and snippets omitted |
| `trivy-version.txt` | Scanner version and cached database metadata |
| `scan-exit-codes.txt` | Whether the two scan commands completed |
| `gate-result.txt` | Final policy outcome after scans and report evaluation completed |

An interrupted or failed scan may produce only some reports; missing `gate-result.txt` does not mean the gate passed. Exit code 10 is reserved by these commands for detected findings; other nonzero codes are treated as scan/evaluation errors. Existing reports are cleared before the run, and the stage archives any new reports even if it fails.

For the assessment, capture the Security stage, its final outcome, and representative findings with package names, CVE IDs, severity, installed version and fixed version. Discuss lower-severity findings too. If a scan reports zero findings, preserve that real result rather than inventing vulnerabilities.

### If Security fails

- **HIGH/CRITICAL image findings:** inspect the package and fixed-version columns. Update the affected base image or package, rebuild, and retain both scan results to demonstrate remediation. For a base-image update, run `docker pull node:24-bookworm-slim` on the Jenkins computer before rerunning, or update the Dockerfile to a reviewed image/version. The replacement artifact must pass Build, Test, and Code Quality again.
- **An unfixed HIGH/CRITICAL finding:** this policy still blocks it. Check the vendor advisory and choose a reviewed remediation or alternative base image. Any later policy exception needs a specific rationale and must be reported; do not silently suppress the finding to obtain a green build.
- **Secret finding:** inspect the reported location locally, remove the value, and use Jenkins credentials where appropriate. Revoke or rotate any real exposed credential. Keep secret values out of screenshots and chat.
- **Database download, container, or timeout error:** fix connectivity or Docker access and rerun. Preserve the error as an execution failure; do not substitute an empty report.

The actual Security stage has not yet run in Windows Jenkins. Its real findings and pass/fail result must be collected before the report claims successful security validation.

## Remaining stages to implement

| Assessed stage | Next implementation |
| --- | --- |
| Deploy | Automatically run the built image in a separate staging environment, then check health and application behaviour. |
| Release | Promote the same tested image to a separate production demonstration environment, with its own configuration and database volume. Verify the release and provide rollback handling. |
| Monitoring and Alerting | Collect the application's metrics with Prometheus, configure alert rules and a working notification receiver, then demonstrate a failure and recovery. |

The current `/metrics` endpoint is preparation for monitoring. A running collector and actual alert delivery are still required. Similarly, running Compose manually is the local development check; the assessed Deploy and Release stages need their own automation.

## Assessment evidence to collect as we progress

Keep screenshots and logs from your own execution: app features, Docker image/version, test results, quality gate, security report, staging and production instances, live monitoring, and a received alert. Count a stage as implemented only when its real operation has been demonstrated.

The final report uses the supplied Word template and is submitted as PDF. Include the demo video link, GitHub repository link, implemented-stage count, project description, pipeline screenshot and stage explanations. The video must be no longer than 10 minutes and include cloning/setup, pipeline operation and the deployed application. Both the marker and unit chair need access to the submitted resources.

## Verification status

The 37 automated backend tests passed on Node.js 24.19.0 in the preparation environment. Generated XML was checked to contain three test suites and 37 test cases without failures. The user's Windows Jenkins build #1 also passed Build and Test, archived the reports, and recorded backend coverage of 100% lines, 99.37% branches and 100% functions. A user-provided browser screenshot demonstrated task creation in the running application.

The user's Windows Jenkins build #3 resolved the earlier automatic-analysis conflict, imported `/usr/src/reports/lcov.info`, uploaded the analysis, passed the SonarQube Cloud quality gate and finished successfully. This verifies Build, Test, and Code Quality for that source revision.

The Security commands were checked against Trivy's official release and CLI documentation. Docker, Jenkins, and Trivy execution are unavailable in the preparation environment. The container mounts, scans, secret-report template, and gate outcome still need the real Windows Jenkins run. Generate and use those real reports for assessment evidence.

## Technical references

- [Node.js test runner](https://nodejs.org/docs/latest-v24.x/api/test.html)
- [Node.js SQLite module](https://nodejs.org/api/sqlite.html)
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Jenkins Windows batch steps](https://www.jenkins.io/doc/pipeline/steps/workflow-durable-task-step/#bat-windows-batch-script)
- [SonarScanner CLI](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/scanners/sonarscanner-cli)
- [SonarQube Cloud analysis parameters and quality-gate polling](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/analysis-parameters/parameters-not-settable-in-ui)
- [JavaScript LCOV coverage parameters](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/test-coverage-parameters)
- [Trivy v0.74.0 release](https://github.com/aquasecurity/trivy/releases/tag/v0.74.0)
- [Trivy container image scanning, including exported archives](https://trivy.dev/docs/latest/guide/target/container_image/)
- [Trivy report conversion and severity gate options](https://trivy.dev/docs/latest/guide/references/configuration/cli/trivy_convert/)
- [Trivy secret scanning and built-in exclusions](https://trivy.dev/docs/latest/guide/scanner/secret/)
