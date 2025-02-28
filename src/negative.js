/**
 * Split the negative from the className
 */
const splitNegative = ({ className, ...rest }) => {
  const hasNegative = className.slice(0, 1) === '-'
  if (hasNegative) {
    className = className.slice(1, className.length)
  }

  return { ...rest, className, hasNegative }
}

export { splitNegative }
