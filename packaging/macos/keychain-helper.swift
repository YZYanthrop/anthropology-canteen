import Foundation
import Security

guard CommandLine.arguments.count >= 4 else {
    fputs("usage: helper get|set|delete service account\n", stderr)
    exit(2)
}

let action = CommandLine.arguments[1]
let service = CommandLine.arguments[2]
let account = CommandLine.arguments[3]
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]

func fail(_ status: OSStatus) -> Never {
    fputs("Keychain operation failed: \(status)\n", stderr)
    exit(1)
}

if action == "get" {
    var result: CFTypeRef?
    let lookupQuery = query.merging([
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
    ]) { _, new in new } as CFDictionary
    let status = SecItemCopyMatching(lookupQuery, &result)
    guard status == errSecSuccess, let data = result as? Data,
          let value = String(data: data, encoding: .utf8) else { fail(status) }
    print(value, terminator: "")
} else if action == "set" {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    let updateAttributes: [String: Any] = [kSecValueData as String: data]
    let status = SecItemUpdate(query as CFDictionary, updateAttributes as CFDictionary)
    if status == errSecItemNotFound {
        var attributes = query
        attributes[kSecValueData as String] = data
        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        if addStatus != errSecSuccess { fail(addStatus) }
    } else if status != errSecSuccess {
        fail(status)
    }
} else if action == "delete" {
    let status = SecItemDelete(query as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound { fail(status) }
} else {
    fputs("unknown action\n", stderr)
    exit(2)
}
