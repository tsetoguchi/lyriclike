import AuthenticationServices
import Capacitor
import Foundation

// Sign in with Apple for the app: asks the system for an identity token and
// hands the fields back to the page. Adapted from the MIT-licensed
// @capacitor-community/apple-sign-in, whose Swift package is pinned to
// Capacitor 7 and cannot be built next to Capacitor 8. See LICENSE.
@objc(AppleSignIn)
public class AppleSignIn: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleSignIn"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
    ]

    // The call waiting on the system sheet. Only one sheet shows at a time.
    private var pendingCallId: String?
    // Kept so the sheet is not released before it answers.
    private var controller: ASAuthorizationController?

    @objc func authorize(_ call: CAPPluginCall) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = requestedScopes(from: call)
        request.nonce = call.getString("nonce")

        pendingCallId = call.callbackId
        bridge?.saveCall(call)

        DispatchQueue.main.async {
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            self.controller = controller
            controller.performRequests()
        }
    }

    private func requestedScopes(from call: CAPPluginCall) -> [ASAuthorization.Scope]? {
        let text = call.getString("scopes") ?? ""
        var scopes: [ASAuthorization.Scope] = []
        if text.contains("name") { scopes.append(.fullName) }
        if text.contains("email") { scopes.append(.email) }
        return scopes.isEmpty ? nil : scopes
    }

    // The saved call, taken out of the bridge so it is answered once.
    private func takePendingCall() -> CAPPluginCall? {
        controller = nil
        guard let id = pendingCallId, let call = bridge?.savedCall(withID: id) else { return nil }
        pendingCallId = nil
        bridge?.releaseCall(call)
        return call
    }
}

// A missing field goes to the page as null, not as a Swift nil, which cannot be sent.
private func orNull(_ value: String?) -> Any {
    return value.map { $0 as Any } ?? NSNull()
}

extension AppleSignIn: ASAuthorizationControllerDelegate {
    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let call = takePendingCall() else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple did not return an identity token.")
            return
        }
        let authorizationCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }

        call.resolve([
            "response": [
                "user": credential.user,
                "email": orNull(credential.email),
                "givenName": orNull(credential.fullName?.givenName),
                "familyName": orNull(credential.fullName?.familyName),
                "identityToken": identityToken,
                "authorizationCode": orNull(authorizationCode),
            ],
        ])
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        guard let call = takePendingCall() else { return }
        // 1001 is the person closing the sheet, which the page treats as a quiet cancel.
        let code = (error as? ASAuthorizationError)?.code.rawValue ?? 0
        call.reject(error.localizedDescription, String(code), error)
    }
}
