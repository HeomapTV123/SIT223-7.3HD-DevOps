# SIT223 HD Task Manager

Taskboard is a small application for the SIT223 7.3HD Jenkins DevOps task. It provides real features that can be built, tested, deployed and monitored: task creation, editing, completion, deletion, searching, filtering and database persistence.

The Jenkinsfile now includes **Build, Test, Code Quality, Security, and Deploy**. Windows Jenkins build #5 verified the first four stages after the smaller runtime image replaced the image blocked in build #4. The new Deploy stage starts a separate staging application, checks it and attempts image rollback on failure; its first Windows Jenkins run is still required. Release and Monitoring with automatic notifications remain to be implemented, followed by the demonstration video and report.

## Start here on Windows

Requirements already checked on your computer: Node.js 24.11.0, Git, Docker Desktop with a working Linux engine, and Jenkins that can run a Docker container. Keep Docker Desktop running.

1. Extract the ZIP. Open the `sit223-hd-task-manager` folder containing `package.json` and `compose.yaml`.
2. Click the File Explorer address bar, type `cmd`, and press Enter. The Command Prompt opens in this folder.
3. Run the application tests:

```cmd
npm test
```

The expected result is **42 tests, 42 passed, 0 failed**: the original 37 application tests and five tests of deployment-check behaviour. Node.js 24.11 may print an experimental warning for its built-in SQLite module; the test exit status and final summary determine the result. No third-party npm packages are required by this application.

4. Build and start the development container:

```cmd
docker compose up --build -d
docker compose ps
```

The first build downloads the Node.js donor image and Alpine base image. The application should eventually show `healthy` in the status column. Open [Taskboard](http://localhost:3000) in your browser.

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
| `test/` | 42 automated validation, storage, HTTP integration and deployment-check tests. |
| `scripts/ci-report.js` | Runs tests with coverage thresholds and writes JUnit and LCOV reports. |
| `scripts/healthcheck.js` | Checks that the running application and database are ready. |
| `scripts/smoke-deploy.mjs` | Checks a deployed app's identity, browser assets, task operations and metrics; cleans up its temporary task. |
| `Dockerfile` | Defines separate test and runtime images from a common base. |
| `compose.yaml` | Runs the local development application with persistent storage. |
| `compose.staging.yaml` | Defines the staging environment using an existing image, a separate database volume and localhost port 3001. |
| `Jenkinsfile` | Build, Test, Code Quality, Security, and Deploy automation for Windows Jenkins. |
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

Coverage measures the four backend modules `app.js`, `store.js`, `validation.js` and `metrics.js`, plus `scripts/smoke-deploy.mjs`. It excludes the startup entry point, frontend JavaScript and other helper scripts. These percentages therefore do not describe the entire application's coverage. The Deploy stage separately checks the running service; interactive browser behaviour still needs a manual check.

The automated tests check real behaviour, including task lifecycles, combined filters, incorrect input, persistence after reopening SQLite, SQL-looking input, browser security headers, cross-origin rejection, health failures and the metrics response.

## How the Docker images work

The `node-source` stage supplies only `/usr/local/bin/node` from `node:24-alpine3.24`. The `base` stage starts from `alpine:3.24`, updates its packages, installs `libstdc++` and its required libraries, then adds that Node executable, the backend and browser assets. This application has no third-party dependencies, so npm, Yarn and their bundled packages are not copied into the application image. A build check fails if npm dependencies are later added without updating this design.

The `test` target shares those application layers, adds the tests and report script, and runs `node scripts/ci-report.js` as the non-root `node` user. Its `/app/reports` directory is writable by that user. The `runtime` target is the default final target; it runs the application as `node`, includes a health check and excludes the tests. UID and GID remain 1000, preserving ownership compatibility with the existing SQLite volume. Local development commands can still use npm on the host.

Alpine uses musl rather than Debian's glibc, so the complete tests and a running-application check must be repeated for this image. The Node donor and Alpine runtime must use the same Alpine release. Defaults can be overridden with the `NODE_IMAGE` and `ALPINE_IMAGE` build arguments; keep them compatible when doing so.

Jenkins builds the runtime with `--pull --no-cache`, refreshing both base images and package installation, then lets the test target reuse that build's application layers and `APP_VERSION`. Tags and package repositories can change, so retain the build log's resolved image digests, `image-metadata.json`, `runtime-node-version.txt` and the security reports for the assessed artifact. Pinning both image digests fixes the base inputs, but package upgrades would still need a fixed package source for an exact rebuild.

The Compose service publishes the application only on `127.0.0.1:3000`. Its root filesystem is read-only; the SQLite directory is writable through the named volume. This is a local coursework application without user authentication.

Optional direct development run, when the Docker application is stopped:

```cmd
npm start
```

This uses `data/tasks.db` in the project folder. It is a different database from the Docker volume. Use Ctrl+C to stop it.

## Jenkins pipeline

Use the included Jenkinsfile after this folder has been committed to your own GitHub repository. Configure the new job as **Pipeline script from SCM**, with Git as SCM and `Jenkinsfile` as the script path. Jenkins checks out the repository automatically. The JUnit plugin must be installed to publish the test results.

This Jenkinsfile defines five assessed stages:

1. **Build** refreshes the base images and packages, creates a runtime image tagged with the Jenkins build number, stores it in the local Docker image store, and archives its metadata and Node version.
2. **Test** builds the test image with the same application layers and build version, runs the tests in a container, copies the reports into the Jenkins workspace and publishes them. Tests or coverage failures fail the stage. The temporary test container is removed afterward.
3. **Code Quality** runs SonarScanner in Docker, imports the LCOV report, submits analysis to SonarQube Cloud and waits for the quality gate. A rejected gate, processing timeout, authentication failure or scanner error fails the stage. The scanner container is removed afterward, and any generated analysis-task metadata and scanner-image metadata are archived.
4. **Security** runs Trivy against an exported copy of the runtime image and scans the checked-out source for secret patterns. It records all vulnerability severities and fails on any HIGH/CRITICAL image vulnerability or any detected source secret. Reports are archived even on failure. Scanner errors and missing reports also fail the stage.
5. **Deploy** uses Docker Compose to run that same image in staging. It waits for Docker health, checks the deployed image ID, runs HTTP smoke checks and checks the published Windows-host port. A failed deployment triggers recovery and fails the build. Deployment evidence is archived on success or failure.

Each runtime image has `APP_VERSION` set to its build identifier. The app displays that value and exposes it through `/health` and `/api/info` so a later deployment can be matched to the build that produced it.

This pipeline uses Windows `bat` steps and a PowerShell host-health request, while its containers run Linux. Build #4 failed Security on image findings. Build #5 checked out commit `625d53b1a7819ec85a79ac074b9c4c8fdc2e2449`, built `sit223-hd-task-manager:build-5`, passed all 37 tests then present, passed SonarQube and passed Security. The expanded 42-test suite and Deploy stage still need a new Windows Jenkins run. The pipeline timeout is 30 minutes; Deploy has its own five-minute limit.

## Configure SonarQube Cloud

The configuration targets organization `heomaptv123`, project `HeomapTV123_SIT223-7.3HD-DevOps`, and the EU service at `https://sonarcloud.io`.

1. Open the project's [Analysis Method page](https://sonarcloud.io/project/configuration/AutoScan?id=HeomapTV123_SIT223-7.3HD-DevOps). Under **Administration > Analysis Method**, turn **Automatic Analysis off** so Jenkins can submit CI analysis.
2. In SonarQube Cloud, open **My account > Access Tokens > Personal Tokens**. Generate a token for Jenkins with an expiry covering the assessment period. The account must be allowed to execute analysis for this project.
3. In Jenkins, open **Manage Jenkins > Credentials > System > Global credentials (unrestricted) > Add Credentials**. Choose **Secret text**, scope **Global**, paste the token into **Secret**, and set the ID to **`sonarcloud-token`**. Keep the token out of source files, commands, screenshots and chat.
4. Confirm that the Jenkins **Credentials Binding** plugin is installed and enabled. The existing Git, Pipeline and JUnit plugins are also used. This Docker scanner setup does not require a separate SonarQube Jenkins plugin or a scanner installation on Windows.
5. Configure the Jenkins job to load `Jenkinsfile` from `*/main`. After these changes are merged to `main`, keep Docker Desktop running and select **Build Now**.

The first run downloads the official scanner image `sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0`. Its release tag is pinned in the Jenkinsfile and its image metadata is archived for traceability. The Windows workspace is mounted at `/usr/src` inside the scanner container; LCOV entries such as `SF:src/app.js` resolve against that directory. Jenkins supplies `SONAR_TOKEN` only while running the scanner, and Docker inherits it by environment-variable name.

`sonar.qualitygate.wait=true` makes the scanner poll SonarQube Cloud for up to 300 seconds after submission. A failed gate or timeout returns an error to Jenkins, blocking later stages. The connection is outbound from Jenkins, so this setup works with local Jenkins without a public webhook endpoint. The source revision is passed from Jenkins' Git checkout to identify the scanned commit. `sonar.projectVersion=1.0.0` is the application version, kept stable across CI builds; update it when preparing a new application release rather than on every build.

Static analysis covers `src`, `public` and `scripts`, with `test` classified as test code. The coverage report measures four backend modules and the deployment smoke script. Uncovered frontend, bootstrap and other helper code remains visible in SonarQube's overall coverage, so it will differ from the Test stage's scoped percentages. No source files or quality rules are excluded to force a passing gate.

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

Build records the runtime's immutable image ID. Security uses `docker image save` with that ID, then scans the archive using `trivy image --input`; Deploy uses the same ID. This works with the Linux engine behind Windows Docker Desktop without sharing its Docker socket with the scanner. The temporary archive is removed in cleanup and is not archived as a Jenkins report.

### Scope and policy

| Check | Scope | Blocking rule |
| --- | --- | --- |
| Image vulnerabilities | OS packages and supported language packages detected in the runtime image, within the scanner's data-source coverage | Any detected HIGH or CRITICAL vulnerability; no fixed-version filter |
| Source secrets | Current checked-out files inspected with Trivy's built-in secret rules | Any reported secret, at any severity |
| Scanner health | Scan commands, report creation, and report conversion | Command failure, timeout, malformed input, or missing required report |

The full image JSON and text reports include UNKNOWN, LOW, MEDIUM, HIGH, and CRITICAL results. The gate reads that same JSON, rather than performing a second vulnerability scan with a potentially different database. The collection command's `--exit-code 0` allows the complete report to be generated; the subsequent mandatory gate uses `--severity HIGH,CRITICAL --exit-code 10` and fails Jenkins when those findings exist. Both report conversions specify `--scanners vuln` to render the vulnerability summary table. There is no `--ignore-unfixed` filter or CVE suppression file in this change.

The source scan skips generated reports, coverage, database data, installed modules, `.scannerwork`, and Git metadata. Trivy's built-in allowed paths and binary/lock-file skip patterns also apply. This checks the current working tree, not deleted secrets in Git history. `ci/secrets-report.tpl` reports only file path, rule ID, severity, and line number; it does not print matched secret values or surrounding source lines. A clean scan means no configured patterns were detected in that scope.

This application has no third-party npm dependencies, so `npm audit` alone would have very little scope. Scanning the built image also assesses the packaged operating system and supported packages shipped with the runtime. These checks complement the functional tests and SonarQube analysis.

Alpine's advisory coverage differs from Debian's. Trivy's Alpine documentation lists unfixed vulnerabilities as unsupported. A passing scan therefore means no blocking findings were detected within that coverage, not that all possible vulnerabilities have been ruled out. Keep this limitation with the before/after assessment evidence.

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

- **HIGH/CRITICAL image findings:** inspect the package, installed-version and fixed-version columns in `trivy-image.json`. Jenkins already pulls current base images and refreshes Alpine packages on every build. If findings remain, update the affected component or choose a reviewed compatible base, rebuild, and retain both reports. The replacement artifact must pass Build, Test, and Code Quality again.
- **An unfixed HIGH/CRITICAL finding:** this policy still blocks it. Check the vendor advisory and choose a reviewed remediation or alternative base image. Any later policy exception needs a specific rationale and must be reported; do not silently suppress the finding to obtain a green build.
- **Secret finding:** inspect the reported location locally, remove the value, and use Jenkins credentials where appropriate. Revoke or rotate any real exposed credential. Keep secret values out of screenshots and chat.
- **Database download, container, or timeout error:** fix connectivity or Docker access and rerun. Preserve the error as an execution failure; do not substitute an empty report.

### First Security result and remediation

Build #4 completed both scans and failed the security gate as intended:

| Scan target | HIGH | CRITICAL | Result |
| --- | --- | --- | --- |
| Debian 12.15 OS packages | 52 | 4 | Blocking findings |
| Node.js packages in the image | 4 | 0 | Blocking findings |
| Checked-out source secrets | — | — | No secret patterns detected |

These are 60 package-level advisory matches, not 60 distinct CVEs; several advisories recur across related packages. A scanner match also requires review of the advisory and application exposure. The OS findings included util-linux-related packages and Perl, with many entries lacking an available fixed version. The Node.js findings named `brace-expansion`, `ip-address` and `tar`; none is declared by this application. Use each result's full package path in `trivy-image.json` to establish its origin.

The replacement image uses a refreshed Alpine base and copies only the Node executable from the compatible official Node image. It omits the Debian utilities and npm/Yarn package trees that the application does not need. The HIGH/CRITICAL and source-secret blocking rules remain unchanged. This reduces the packaged components; only a new scan can establish the new image's findings and gate outcome.

Build #5 completed the replacement-image run successfully: Docker built Alpine 3.24.2, all 37 tests then present passed, SonarQube passed, the HIGH/CRITICAL table reported zero findings for both the OS and application package target, and the source scan found no secret patterns. Its console ended with `Finished: SUCCESS`. This verifies the configured gate, rather than proving the absence of every vulnerability. The log's EOL-list warning reflects missing Alpine 3.24 support-date metadata in Trivy 0.74.0; scanning continued.

Keep build #4's console and reports alongside build #5's reports. The new Deploy stage will also exercise the running Alpine application and its database volume; collect that separate result before claiming deployment validation.

## Run the Deploy stage

Deploy runs only after Build, Test, Code Quality and Security pass. It uses Docker Compose v2 with `up --wait` and `--wait-timeout` support, as provided by current Docker Desktop. The Windows `powershell` step comes from Jenkins' existing Pipeline: Nodes and Processes plugin. The smoke client uses Node from the built image, so Jenkins does not need Node on its Windows PATH for deployment. No new credential is required.

| Environment | Browser URL | Container | Database volume |
| --- | --- | --- | --- |
| Development (manual Compose) | `http://localhost:3000` | Managed by `compose.yaml` | `sit223-hd-task-manager_task-data` |
| Staging (Jenkins Deploy) | `http://localhost:3001` | `sit223-hd-staging` | `sit223-hd-staging_staging-data` |

The staging service runs as the image's non-root user, has a read-only root filesystem and writable data volume, and binds only to the Jenkins computer's loopback address. It remains running after a successful pipeline so it can be inspected in a browser. These are separate environments on the same Docker engine, not separate physical servers or a public deployment.

### First deployment and evidence

1. Review and merge the Deploy pull request into `main`. Keep Docker Desktop running and ensure port 3001 is available.
2. Run the existing Jenkins job. If **Build with Parameters** is shown, leave **VERIFY_STAGING_ROLLBACK** unchecked for a normal deployment. The first run after merging may still show **Build Now** until Jenkins loads the parameter definition.
3. Confirm all 42 tests and both gates pass, followed by the fifth stage, **Deploy**. Compose waits up to 90 seconds for the image's health check; startup failure or timeout blocks the stage.
4. Open `http://localhost:3001` on the Jenkins computer. The page should identify the environment as `staging` and show the current `build-N` version. Open `/health` to confirm those values and `status: ok`.
5. Create a task manually and refresh the page. After another normal Jenkins deployment, confirm that task is still there. The named volume is reused; the pipeline's smoke checks delete only the temporary task they create.
6. Save the five-stage pipeline screenshot, staging page and the build's **Artifacts > reports > deploy** files. The archive page can download that directory as a ZIP.

The smoke client checks health and release identity before writing anything, then checks HTML/CSS/JavaScript responses, creates a unique task, reads and filters it, marks it done, checks metrics and deletes it. It fails on any unexpected response, including cleanup failure. A separate Windows-host health request verifies the published port, rather than relying solely on HTTP within Docker.

| Deployment artifact | Purpose |
| --- | --- |
| `deployment-context.txt` | Build, commit, image ID, environment, URL and rollback-demo setting |
| `deployment-result.txt` | `PASSED`, `FAILED` or `NOT_COMPLETED`; passing requires every deployment check |
| `compose-version.txt` | Compose version used by Jenkins |
| `previous-image.txt`, `previous-container.json` | Previous staging image and configuration; container JSON exists only when staging already existed |
| `smoke-test.json` | Individual HTTP-check results and timestamps |
| `host-health.json` | Response from the Windows host's published staging endpoint |
| `final-container.json`, `final-container.log` | Container state and recent logs after deployment or recovery |
| `failed-container.json`, `failed-container.log`, `rollback-result.txt` | Failed attempt and recovery outcome, when applicable |

Missing reports after interruption or an early error are not a passing result. `NOT_COMPLETED` is written before deployment starts and replaced only when the attempt completes. Empty `*-inspect-error.txt` files mean that inspection produced no error output.

### Failure handling and rollback demonstration

Before replacing an existing staging container, Jenkins checks its Compose project/service labels and records its image ID. It refuses to replace a same-name container owned by another project. A failed startup, image mismatch, smoke check or host-health request triggers an attempt to restore the previous image and wait for Docker health. A successful rollback still leaves the Jenkins build failed so the rejected change cannot be promoted. On the first deployment, there is no previous image: Jenkins stops the failed service and preserves the volume.

After one normal deployment succeeds, an optional **Build with Parameters > VERIFY_STAGING_ROLLBACK** run deliberately fails Deploy after its checks pass. Jenkins then attempts to restore the previous image. Use the failed build's `deployment-result.txt`, `rollback-result.txt` and container metadata, plus the restored browser version, as real rollback evidence. Leave the option unchecked on subsequent normal runs. The flag does not skip tests, quality analysis or security scanning.

Rollback restores the previous application image using the current Compose configuration. It does not restore database contents or undo schema migrations. Future schema changes must remain compatible with the previous application version or have a separate reviewed recovery plan. Replacing a single staging container causes brief downtime. Abrupt Jenkins/Docker shutdown or a hard timeout can interrupt recovery; inspect Docker Desktop and the artifacts before retrying. Use only one Jenkins job for this fixed staging project.

For a port conflict, free port 3001 or deliberately change the staging port consistently in Compose and the Jenkins URL. For a health or smoke failure, read the failed-container log and `smoke-test.json`; for an unknown Compose option, check Docker Desktop's Compose version. Do not delete the staging data volume to make an error disappear.

## Remaining stages to implement

| Assessed stage | Next implementation |
| --- | --- |
| Release | Promote the same tested image to a separate production demonstration environment, with its own configuration and database volume. Verify the release and provide rollback handling. |
| Monitoring and Alerting | Collect the application's metrics with Prometheus, configure alert rules and a working notification receiver, then demonstrate a failure and recovery. |

The current `/metrics` endpoint and its Deploy check are preparation for monitoring. A running collector and actual alert delivery are still required. Deploy automation is now prepared and needs its real Jenkins verification; Release automation is the next implementation after that.

## Assessment evidence to collect as we progress

Keep screenshots and logs from your own execution: app features, Docker image/version, test results, quality gate, security report, staging and production instances, live monitoring, and a received alert. Count a stage as implemented only when its real operation has been demonstrated.

The final report uses the supplied Word template and is submitted as PDF. Include the demo video link, GitHub repository link, implemented-stage count, project description, pipeline screenshot and stage explanations. The video must be no longer than 10 minutes and include cloning/setup, pipeline operation and the deployed application. Both the marker and unit chair need access to the submitted resources.

## Verification status

The 37 automated backend tests passed on Node.js 24.19.0 in the preparation environment. Generated XML was checked to contain three test suites and 37 test cases without failures. The user's Windows Jenkins build #1 also passed Build and Test, archived the reports, and recorded backend coverage of 100% lines, 99.37% branches and 100% functions. A user-provided browser screenshot demonstrated task creation in the running application.

The user's Windows Jenkins build #3 resolved the earlier automatic-analysis conflict, imported `/usr/src/reports/lcov.info`, uploaded the analysis, passed the SonarQube Cloud quality gate and finished successfully. This verifies Build, Test, and Code Quality for that source revision.

The user's Windows Jenkins build #4 verified the Security container mounts, image scan, source-secret report template, report archiving and blocking gate. It failed on 56 HIGH and 4 CRITICAL package-level image findings, while the source scan reported no secret patterns. Build, Test and Code Quality passed in that same run.

The user's Windows Jenkins build #5 verified the Alpine image, non-root test reports, SonarQube and the configured Security gate. The source-secret scan found no patterns and the displayed HIGH/CRITICAL image results were zero.

The new 42-test suite passed locally on Node.js 24.19.0, with 100% lines, 98.97% branches and 100% functions across the four backend modules and smoke script. JUnit contains 42 cases without failures, and all five LCOV source paths resolve. The smoke tests cover real HTTP requests, wrong release/environment rejection, failure cleanup and a nonzero CLI exit status.

Docker, Jenkins, Windows PowerShell and Trivy execution are unavailable in the preparation environment. The staging Compose launch, published Windows port, bind mount and rollback still need real Windows Jenkins runs. The local tests do not establish that those integration steps succeeded. Generate and use those real deployment reports for assessment evidence.

## Technical references

- [Node.js test runner](https://nodejs.org/docs/latest-v24.x/api/test.html)
- [Node.js SQLite module](https://nodejs.org/api/sqlite.html)
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker Compose deployment and health waiting](https://docs.docker.com/reference/cli/docker/compose/up/)
- [Docker named volumes and persistence](https://docs.docker.com/engine/storage/volumes/)
- [Official Node image guidance for a smaller runtime without npm/Yarn](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#smaller-images-without-npmyarn)
- [Official Node 24 Alpine 3.24 image definition](https://github.com/nodejs/docker-node/blob/main/24/alpine3.24/Dockerfile)
- [Docker build options for pulling base images and disabling cache](https://docs.docker.com/reference/cli/docker/buildx/build/)
- [Jenkins Windows batch steps](https://www.jenkins.io/doc/pipeline/steps/workflow-durable-task-step/#bat-windows-batch-script)
- [SonarScanner CLI](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/scanners/sonarscanner-cli)
- [SonarQube Cloud analysis parameters and quality-gate polling](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/analysis-parameters/parameters-not-settable-in-ui)
- [JavaScript LCOV coverage parameters](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/test-coverage-parameters)
- [Trivy v0.74.0 release](https://github.com/aquasecurity/trivy/releases/tag/v0.74.0)
- [Trivy container image scanning, including exported archives](https://trivy.dev/docs/latest/guide/target/container_image/)
- [Trivy report conversion and severity gate options](https://trivy.dev/docs/latest/guide/references/configuration/cli/trivy_convert/)
- [Trivy secret scanning and built-in exclusions](https://trivy.dev/docs/latest/guide/scanner/secret/)
- [Trivy Alpine vulnerability-coverage limitations](https://trivy.dev/docs/v0.74/guide/coverage/os/alpine/)
