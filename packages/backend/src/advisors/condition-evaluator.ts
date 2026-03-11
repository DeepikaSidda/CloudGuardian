import { ConditionOperator } from "@governance-engine/shared";

/**
 * Extracts a property value from a resource object, supporting "Tags.KeyName" dot notation.
 *
 * - If propertyPath starts with "Tags.", looks up the tag key in the resource's Tags map
 *   (expected to be Record<string, string>).
 * - Otherwise, returns resource[propertyPath].
 */
export function extractPropertyValue(
  resource: Record<string, unknown>,
  propertyPath: string
): unknown {
  if (propertyPath.startsWith("Tags.")) {
    const tagKey = propertyPath.slice(5); // portion after "Tags."
    const tags = resource["Tags"];
    if (tags == null || typeof tags !== "object") {
      return undefined;
    }
    return (tags as Record<string, string>)[tagKey];
  }
  return resource[propertyPath];
}

/**
 * Evaluates a condition against a property value.
 * Returns true when a VIOLATION is detected.
 *
 * Operator semantics (true = violation):
 * - equals:       violation if propertyValue !== conditionValue
 * - not_equals:   violation if propertyValue === conditionValue
 * - greater_than: violation if propertyValue > conditionValue (numeric)
 * - less_than:    violation if propertyValue < conditionValue (numeric)
 * - in:           violation if propertyValue is NOT in conditionValue array
 * - not_in:       violation if propertyValue IS in conditionValue array
 * - contains:     violation if propertyValue does NOT contain conditionValue
 * - not_contains: violation if propertyValue DOES contain conditionValue
 * - exists:       violation if propertyValue is undefined or null
 * - not_exists:   violation if propertyValue is defined and not null
 */
export function evaluateCondition(
  propertyValue: unknown,
  operator: ConditionOperator,
  conditionValue: unknown
): boolean {
  switch (operator) {
    case "equals":
      return propertyValue !== conditionValue;

    case "not_equals":
      return propertyValue === conditionValue;

    case "greater_than": {
      if (propertyValue == null || typeof propertyValue !== "number") return false;
      return propertyValue > (conditionValue as number);
    }

    case "less_than": {
      if (propertyValue == null || typeof propertyValue !== "number") return false;
      return propertyValue < (conditionValue as number);
    }

    case "in": {
      const arr = conditionValue as unknown[];
      if (!Array.isArray(arr)) return false;
      return !arr.includes(propertyValue);
    }

    case "not_in": {
      const arr = conditionValue as unknown[];
      if (!Array.isArray(arr)) return false;
      return arr.includes(propertyValue);
    }

    case "contains": {
      if (propertyValue == null) return true;
      if (typeof propertyValue === "string") {
        return !propertyValue.includes(String(conditionValue));
      }
      if (Array.isArray(propertyValue)) {
        return !propertyValue.includes(conditionValue);
      }
      return true;
    }

    case "not_contains": {
      if (propertyValue == null) return false;
      if (typeof propertyValue === "string") {
        return propertyValue.includes(String(conditionValue));
      }
      if (Array.isArray(propertyValue)) {
        return propertyValue.includes(conditionValue);
      }
      return false;
    }

    case "exists":
      return propertyValue === undefined || propertyValue === null;

    case "not_exists":
      return propertyValue !== undefined && propertyValue !== null;

    default:
      return false;
  }
}
