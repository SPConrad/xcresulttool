/*eslint-disable @typescript-eslint/no-explicit-any */

import * as exec from '@actions/exec'
import {promises} from 'fs'
const {readFile} = promises

export class Parser {
  private bundlePath: string

  constructor(bundlePath: string) {
    this.bundlePath = bundlePath
  }

  async parse(reference?: string): Promise<any> {
    const root = JSON.parse(await this.toJSON(reference))
    return parseObject(root) as any
  }

  async exportObject(reference: string, outputPath: string): Promise<Buffer> {
    let args = [
      'xcresulttool',
      'export',
      '--type',
      'file',
      '--path',
      this.bundlePath,
      '--output-path',
      outputPath,
      '--id',
      reference
    ]
    if (await this.requiresLegacyFlag()) {
      args.splice(2, 0, '--legacy')
    }
    const options = {
      silent: true
    }

    await exec.exec('xcrun', args, options)
    return Buffer.from(await readFile(outputPath))
  }

  async exportCodeCoverage(): Promise<string> {
    const args = ['xccov', 'view', '--report', '--json', this.bundlePath]

    let output = ''
    const options = {
      silent: true,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString()
        }
      }
    }

    await exec.exec('xcrun', args, options)
    return output
  }

  private async requiresLegacyFlag(): Promise<boolean> {
    let output = ''
    const options = {
      silent: true,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString()
        }
      }
    }
    await exec.exec('xcrun', ['xcresulttool', 'version'], options)
    const version = parseFloat(output.split(/[ ,]+/)[2])
    return version > 23000
  }

  private async toJSON(reference?: string): Promise<string> {
    let args = [
      'xcresulttool',
      'get',
      '--path',
      this.bundlePath,
      '--format',
      'json'
    ]
    if (await this.requiresLegacyFlag()) {
      args.splice(2, 0, '--legacy')
    }
    if (reference) {
      args.push('--id')
      args.push(reference)
    }

    let output = ''
    const options = {
      silent: true,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString()
        }
      }
    }

    await exec.exec('xcrun', args, options)
    return output
  }
}

function parseObject(element: object): object {
  const obj: any = {}

  for (const [key, value] of Object.entries(element)) {
    if (value['_value']) {
      obj[key] = parsePrimitive(value)
    } else if (value['_values']) {
      obj[key] = parseArray(value)
    } else if (key === '_type') {
      continue
    } else {
      obj[key] = parseObject(value)
    }
  }

  return obj
}

function parseArray(arrayElement: any): any {
  return arrayElement['_values'].map((arrayValue: object) => {
    const obj: any = {}
    for (const [key, value] of Object.entries(arrayValue)) {
      if (value['_value']) {
        obj[key] = parsePrimitive(value)
      } else if (value['_values']) {
        obj[key] = parseArray(value)
      } else if (key === '_type') {
        continue
      } else if (key === '_value') {
        continue
      } else {
        obj[key] = parseObject(value)
      }
    }
    return obj
  })
}

function parsePrimitive(element: any): any {
  switch (element['_type']['_name']) {
    case 'Int':
      return parseInt(element['_value'])
    case 'Double':
      return parseFloat(element['_value'])
    default:
      return element['_value']
  }
}
