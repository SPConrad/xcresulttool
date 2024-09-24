import * as artifact from '@actions/artifact'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import * as os from 'os'
import * as path from 'path'
import {Formatter} from './formatter'
import {Octokit} from '@octokit/action'
import {glob} from 'glob'
import {promises} from 'fs'
const {stat} = promises

async function run(): Promise<void> {
  try {
    const inputPaths = core.getMultilineInput('path')
    const showPassedTests = core.getBooleanInput('show-passed-tests')
    const showCodeCoverage = core.getBooleanInput('show-code-coverage')
    let uploadBundles = core.getInput('upload-bundles').toLowerCase()
    if (uploadBundles === 'true') {
      uploadBundles = 'always'
    } else if (uploadBundles === 'false') {
      uploadBundles = 'never'
    }

    const bundlePaths: string[] = []
    for (const checkPath of inputPaths) {
      try {
        await stat(checkPath)
        bundlePaths.push(checkPath)
      } catch (error) {
        core.error((error as Error).message)
      }
    }
    let bundlePath = path.join(os.tmpdir(), 'Merged.xcresult')
    if (inputPaths.length > 1) {
      await mergeResultBundle(bundlePaths, bundlePath)
    } else {
      const inputPath = inputPaths[0]
      await stat(inputPath)
      bundlePath = inputPath
    }

    const formatter = new Formatter(bundlePath)
    const report = await formatter.format({
      showPassedTests,
      showCodeCoverage
    })

    if (core.getInput('token')) {
      const byteLengthLimit = 65535
      let reportTitle = trimToByteLength(
        'summary',
        core.getInput('title'),
        byteLengthLimit
      )
      let reportSummary = trimToByteLength(
        'summary',
        report.reportSummary,
        byteLengthLimit
      )
      let reportDetail = trimToByteLength(
        'text',
        report.reportDetail,
        byteLengthLimit
      )

      await core.summary.addRaw(reportSummary).write()

      const octokit = new Octokit()

      const owner = github.context.repo.owner
      const repo = github.context.repo.repo

      const pr = github.context.payload.pull_request
      const sha = (pr && pr.head.sha) || github.context.sha

      if (report.annotations.length > 50) {
        core.warning(
          'Annotations that exceed the limit (50) will be truncated.'
        )
      }
      const annotations = report.annotations.slice(0, 50)
      let output
      if (reportDetail.trim()) {
        output = {
          title: 'Xcode test results',
          summary: reportSummary,
          text: reportDetail,
          annotations
        }
      } else {
        output = {
          title: 'Xcode test results',
          summary: reportSummary,
          annotations
        }
      }
      await octokit.checks.create({
        owner,
        repo,
        name: reportTitle,
        head_sha: sha,
        status: 'completed',
        conclusion: report.testStatus,
        output
      })

      if (
        uploadBundles === 'always' ||
        (uploadBundles === 'failure' && report.testStatus === 'failure')
      ) {
        for (const uploadBundlePath of inputPaths) {
          try {
            await stat(uploadBundlePath)
          } catch (error) {
            continue
          }

          const artifactClient = artifact.create()
          const artifactName = path.basename(uploadBundlePath)

          const rootDirectory = uploadBundlePath
          const options = {
            continueOnError: false
          }

          glob(`${uploadBundlePath}/**/*`, async (error, files) => {
            if (error) {
              core.error(error)
            }
            if (files.length) {
              await artifactClient.uploadArtifact(
                artifactName,
                files,
                rootDirectory,
                options
              )
            }
          })
        }
      }
    }
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}

run()

async function mergeResultBundle(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  const args = ['xcresulttool', 'merge']
    .concat(inputPaths)
    .concat(['--output-path', outputPath])
  const options = {
    silent: true
  }

  await exec.exec('xcrun', args, options)
}

function trimToByteLength(
  name: string,
  str: string,
  byteLength: number
): string {
  const buf = Buffer.from(str, 'utf8')
  if (buf.length <= byteLength) {
    return str
  }

  let trimmed = str.slice(0, byteLength)
  while (Buffer.byteLength(trimmed, 'utf8') > byteLength) {
    trimmed = trimmed.slice(0, -1)
  }
  if (trimmed.length < str.length) {
    core.warning(
      `The '${name}' will be truncated because it exceeded the maximum length ${byteLength}.`
    )
  }

  return trimmed
}
