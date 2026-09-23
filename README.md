# SIT223 HD Task Manager

Taskboard is a small application for the SIT223 7.3HD Jenkins DevOps task. It provides real features that can be built, tested, deployed and monitored: task creation, editing, completion, deletion, searching, filtering and database persistence.

The Jenkinsfile now includes **Build, Test, and Code Quality**. Build and Test passed in Windows Jenkins build #1 with 37 passing tests. Code Quality is configured for SonarQube Cloud and needs its first authenticated Jenkins run. The full assessment still needs Security, Deploy, Release, and Monitoring with automatic notifications, followed by the demonstration video and report.

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
| `Jenkinsfile` | Build, Test, and Code Quality automation for Windows Jenkins. |
| `sonar-project.properties` | SonarQube Cloud project identifiers, source scope, coverage import, and quality-gate settings. |

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

This Jenkinsfile defines three assessed stages:

1. **Build** creates a runtime image tagged with the Jenkins build number, stores it in the local Docker image store and archives its metadata.
2. **Test** builds the test image, runs the tests in a container, copies the reports into the Jenkins workspace and publishes them. Tests or coverage failures fail the stage. The temporary test container is removed afterward.
3. **Code Quality** runs SonarScanner in Docker, imports the LCOV report, submits analysis to SonarQube Cloud and waits for the quality gate. A rejected gate, processing timeout, authentication failure or scanner error fails the stage. The scanner container is removed afterward, and any generated analysis-task metadata and scanner-image metadata are archived.

Each runtime image has `APP_VERSION` set to its build identifier. The app displays that value and exposes it through `/health` and `/api/info` so a later deployment can be matched to the build that produced it.

This pipeline uses `bat` because the Jenkins executor is Windows, even though the containers themselves run Linux. Build #1 checked out commit `bb72e9836f6a42b0d199aabac9d83d01edb8ec67`, built the application image and passed all 37 tests. Run the updated pipeline to verify Code Quality against the real SonarQube Cloud project.

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

## Remaining stages to implement

| Assessed stage | Next implementation |
| --- | --- |
| Security | Scan the application/image with a security tool such as Trivy; document findings, severity and remediation. This project has no third-party npm dependencies, so an npm audit alone would have very little scope. |
| Deploy | Automatically run the built image in a separate staging environment, then check health and application behaviour. |
| Release | Promote the same tested image to a separate production demonstration environment, with its own configuration and database volume. Verify the release and provide rollback handling. |
| Monitoring and Alerting | Collect the application's metrics with Prometheus, configure alert rules and a working notification receiver, then demonstrate a failure and recovery. |

The current `/metrics` endpoint is preparation for monitoring. A running collector and actual alert delivery are still required. Similarly, running Compose manually is the local development check; the assessed Deploy and Release stages need their own automation.

## Assessment evidence to collect as we progress

Keep screenshots and logs from your own execution: app features, Docker image/version, test results, quality gate, security report, staging and production instances, live monitoring, and a received alert. Count a stage as implemented only when its real operation has been demonstrated.

The final report uses the supplied Word template and is submitted as PDF. Include the demo video link, GitHub repository link, implemented-stage count, project description, pipeline screenshot and stage explanations. The video must be no longer than 10 minutes and include cloning/setup, pipeline operation and the deployed application. Both the marker and unit chair need access to the submitted resources.

## Verification status

The 37 automated backend tests passed on Node.js 24.19.0 in the preparation environment. Generated XML was checked to contain three test suites and 37 test cases without failures. The user's Windows Jenkins build #1 also passed Build and Test, archived the reports, and recorded backend coverage of 100% lines, 99.37% branches and 100% functions. A user-provided browser screenshot demonstrated task creation in the running application.

The Code Quality integration has been checked against the official scanner documentation and the generated relative LCOV paths. Docker and Jenkins are unavailable in the preparation environment, and no SonarQube token is available there. Its authenticated scanner run and quality-gate outcome must therefore be verified in Windows Jenkins. Generate and use the resulting real reports for assessment evidence.

## Technical references

- [Node.js test runner](https://nodejs.org/docs/latest-v24.x/api/test.html)
- [Node.js SQLite module](https://nodejs.org/api/sqlite.html)
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Jenkins Windows batch steps](https://www.jenkins.io/doc/pipeline/steps/workflow-durable-task-step/#bat-windows-batch-script)
- [SonarScanner CLI](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/scanners/sonarscanner-cli)
- [SonarQube Cloud analysis parameters and quality-gate polling](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/analysis-parameters/parameters-not-settable-in-ui)
- [JavaScript LCOV coverage parameters](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/test-coverage-parameters)
