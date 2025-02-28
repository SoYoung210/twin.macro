import {
  resolveTailwindConfig,
  processPlugins,
  defaultTailwindConfig,
} from './tailwindHelpers'
import { logNoClass, softMatchConfigs } from './logging'
import dlv from 'dlv'
import dset from 'dset'
export { stringifyScreen } from './screens' // For backwards compat
import { MacroError } from 'babel-plugin-macros'

let resolvedConfig

const resolveConfig = config => {
  if (resolvedConfig) return resolvedConfig
  resolvedConfig = resolveTailwindConfig([config, defaultTailwindConfig])
  return resolvedConfig
}

const assert = (expression, error) => {
  if (!expression) return
  throw new MacroError(error)
}

const isEmpty = value =>
  value === undefined ||
  value === null ||
  (typeof value === 'object' && Object.keys(value).length === 0) ||
  (typeof value === 'string' && value.trim().length === 0)

const styleify = ({ prop, value }) =>
  Array.isArray(prop)
    ? prop.reduce(
        (accumulator, item) => ({
          ...accumulator,
          [item]: value,
        }),
        {}
      )
    : { [prop]: value }

/**
 * Matches
 */

function matchString(value) {
  if (typeof value !== 'string') return
  return value
}

function matchNumberAsString(value) {
  if (typeof value !== 'number') return
  return String(value)
}

function matchDefaultValue(value) {
  if (typeof value !== 'object') return
  if (!value.default) return
  return value.default
}

function matchObject(value) {
  if (!value) return
  if (typeof value !== 'object') return
  return value
}

function checkNewStyle({ config, key, prop }) {
  // String-ish
  const stringMatch =
    matchString(config[key]) || matchNumberAsString(config[key])
  if (stringMatch) {
    return styleify({
      prop,
      value: stringMatch,
    })
  }

  // Default
  const defaultValueMatch = matchDefaultValue(config[key])
  if (defaultValueMatch) {
    return styleify({
      prop,
      value: defaultValueMatch,
    })
  }

  // Font family
  if (prop === 'fontFamily') {
    const objectMatch = matchObject(config[key])
    if (objectMatch && Array.isArray(Object.values(objectMatch))) {
      return styleify({
        prop,
        value: Object.values(objectMatch).join(', '),
      })
    }
  }

  // Object
  const objectMatch = matchObject(config[key])
  if (objectMatch) {
    const newStyleCheck = checkNewStyle({
      config: Object.values(objectMatch),
      key,
      prop,
    })
    if (newStyleCheck) {
      return newStyleCheck
    }
  }
}

function resolveStyleFromPlugins({ config, className }) {
  const pluginClassNames = {}

  if (!config.plugins || config.plugins.length === 0) {
    return
  }

  const processedPlugins = processPlugins(config.plugins, config)
  // Only plugin utilities for now, plugin components are much more complex
  // This mimics the tailwind.macro functionality
  processedPlugins.utilities.forEach(rule => {
    if (rule.type !== 'atrule' || rule.name !== 'variants') {
      return
    }

    rule.each(x => {
      const match = x.selector.match(/^\.(\S+)(\s+.*?)?$/)
      if (match === null) {
        return
      }

      const name = match[1]
      const rest = match[2]
      const keys = rest ? [name, rest.trim()] : [name]
      dset(pluginClassNames, keys, {})
      x.walkDecls(decl => {
        dset(pluginClassNames, keys.concat(decl.prop), decl.value)
      })
    })
  })
  const output =
    typeof pluginClassNames[className] !== 'undefined'
      ? pluginClassNames[className]
      : null
  return output
}

function resolveStyle(properties) {
  const {
    styleList,
    key,
    className,
    prefix,
    config,
    hasSuggestions,
  } = properties
  // Deal with Array items like 'font' or 'bg'
  if (Array.isArray(styleList)) {
    const resultsRaw = styleList.map(item => resolve(item, ...properties))
    const results = Object.values(resultsRaw).find(
      x => x && Object.values(x)[0] !== undefined
    )
    assert(
      !results,
      // TODO: Add class suggestions for these types
      logNoClass({
        className: `${prefix}${className}`,
        hasSuggestions,
      })
    )

    return results
  }

  if (typeof styleList === 'object') {
    const results = resolve(styleList, ...properties)
    assert(
      isEmpty(results),
      logNoClass({
        className: `${prefix}${className}`,
        hasSuggestions,
        config: softMatchConfigs({
          className,
          configTheme: config.theme,
          prefix,
        }),
      })
    )

    return results
  }

  throw new MacroError(
    `"${className}" requires "${key}" in the Tailwind config`
  )
}

function resolve(opt, { config, key, className, prefix }) {
  // Get the key from classNames style config
  const findKey = dlv(config, ['theme', opt.config], {})
  // Check the key is defined in the tailwind config
  const checkValidConfig = matchObject(findKey)
  assert(
    !checkValidConfig,
    `${className} expects ${opt.config} in the Tailwind config`
  )

  // Check for hyphenated key matches eg: row-span-2 ("span-2" being the key)
  const keyMatch = findKey[`${prefix}${key || 'default'}`] || null
  if (keyMatch) {
    const stringResults = checkNewStyle({
      config: findKey,
      key: `${prefix}${key || 'default'}`,
      prop: opt.prop,
    })
    if (stringResults) {
      return stringResults
    }
  }

  // Check using className splitting
  const classParts =
    className && className.includes('-')
      ? className.split('-').filter(Boolean)
      : [className]

  let index = 0
  // Match parts of the classname against the config
  for (const item of Object.entries(classParts)) {
    const [index, part] = item
    const partFound = Object.keys(findKey).includes(part)
    if (partFound) {
      const value = findKey[part] || null
      if (value) {
        const newKey = classParts[Number(index) + 1]
        const stringResults = checkNewStyle({
          config: value,
          key: newKey,
          prop: opt.prop,
        })
        if (stringResults) {
          return stringResults
        }
      }
    }
  }

  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  for (const _ of classParts) {
    index = index + 1

    const keyNext = classParts[index] ? classParts[index] : null
    const keyFound = findKey[`${prefix}${keyNext}`]

    if (keyFound) {
      const stringResults = checkNewStyle({
        className,
        config: keyFound,
        key,
        prop: opt.prop,
      })

      if (stringResults) {
        return styleify({
          prop: opt.prop,
          value: stringResults,
        })
      }
    }
  }

  return {}
}

export { resolveConfig, assert, resolveStyleFromPlugins, resolveStyle, isEmpty }
