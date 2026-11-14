import Capacitor
import Foundation
import StoreKit
import UIKit

private let PRODUCT_IDS = [
    "com.lyriclike.app.pro.monthly",
    "com.lyriclike.app.pro.yearly",
]
private let GROUP_ID = "22555704"
private let TRANSACTION_EVENT = "transaction"

private let RESULT_PURCHASED = "purchased"
private let RESULT_PENDING = "pending"
private let RESULT_CANCELLED = "cancelled"

private let ERROR_BAD_TOKEN = "bad-token"
private let ERROR_BAD_ID = "bad-id"
private let ERROR_BUSY = "busy"
private let ERROR_UNVERIFIED = "unverified"
private let ERROR_UNKNOWN_ITEM = "unknown-item"
private let ERROR_NO_WINDOW = "no-window"
private let ERROR_STORE = "store-error"
private let ERROR_CANNOT_OPEN = "cannot-open"

private let REVIEW_URL_FORMAT = "https://apps.apple.com/app/id%@?action=write-review"

private typealias GroupInfo = Product.SubscriptionInfo // word-check: allow
private typealias GroupStatus = GroupInfo.Status
private typealias PeriodUnit = Product.SubscriptionPeriod.Unit // word-check: allow

private struct StoreError: Error {
    let message: String
    let code: String
}

// Buying, restoring and listing items through StoreKit 2. The plugin never
// finishes a transaction by itself: the page finishes it once the server has
// saved it, so StoreKit delivers a lost one again on the next launch.
@objc(AppStore)
public class AppStore: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppStore"
    public let jsName = "AppStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listItems", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ownedItems", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeReview", returnType: CAPPluginReturnPromise),
    ]

    // True while a purchase sheet is open. Read and written on the main actor.
    private var isBuying = false
    private let unfinished = UnfinishedTransactions()
    private var updatesTask: Task<Void, Never>?

    override public func load() {
        updatesTask = listenForTransactions()
    }

    deinit {
        updatesTask?.cancel()
    }

    @objc func listItems(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") ?? []).compactMap { $0 as? String }
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve(["items": products.map { self.itemData($0) }])
            } catch {
                call.reject(error.localizedDescription, ERROR_STORE, error)
            }
        }
    }

    @objc func buy(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("No item id was given.", ERROR_BAD_ID)
            return
        }
        let tokenText = call.getString("accountToken") ?? ""
        guard let token = UUID(uuidString: tokenText) else {
            call.reject("The account token is not a UUID.", ERROR_BAD_TOKEN)
            return
        }
        Task { @MainActor in
            await self.startBuy(call, id: id, token: token)
        }
    }

    @objc func ownedItems(_ call: CAPPluginCall) {
        Task {
            await self.resolveOwnedItems(call)
        }
    }

    // sync() can fail even when the phone already holds the purchase (seen in
    // TestFlight as "Unable to Complete Request"), so what StoreKit already
    // has is still answered. Only an empty list keeps the sync error.
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await StoreKit.AppStore.sync()
            } catch {
                await self.resolveKnownItems(call, syncError: error)
                return
            }
            await self.resolveOwnedItems(call)
        }
    }

    @objc func manage(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.activeWindowScene() else {
                call.reject("No window is open.", ERROR_NO_WINDOW)
                return
            }
            do {
                let store = StoreKit.AppStore.self
                try await store.showManageSubscriptions(in: scene) // word-check: allow
                call.resolve()
            } catch {
                call.reject(error.localizedDescription, ERROR_STORE, error)
            }
        }
    }

    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("transactionId").flatMap({ UInt64($0) }) else {
            call.reject("No transaction id was given.", ERROR_BAD_ID)
            return
        }
        Task {
            guard let transaction = await self.unfinishedTransaction(id) else {
                call.resolve(["finished": false])
                return
            }
            await transaction.finish()
            call.resolve(["finished": true])
        }
    }
}

// MARK: - Reviews

extension AppStore {
    // Apple decides whether the sheet shows (at most three times a year) and
    // never says, so this resolves either way.
    @objc func requestReview(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.activeWindowScene() else {
                call.reject("No window is open.", ERROR_NO_WINDOW)
                return
            }
            if #available(iOS 16.0, *) {
                StoreKit.AppStore.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve()
        }
    }

    // Opens the App Store app on the write-a-review page. Not limited by
    // Apple, so it suits a button the person taps.
    @objc func writeReview(_ call: CAPPluginCall) {
        let appId = call.getString("appId") ?? ""
        guard !appId.isEmpty, appId.allSatisfy(\.isNumber),
              let url = URL(string: String(format: REVIEW_URL_FORMAT, appId)) else {
            call.reject("The App Store id is not a number.", ERROR_BAD_ID)
            return
        }
        Task { @MainActor in
            let isOpened = await UIApplication.shared.open(url)
            if isOpened {
                call.resolve()
            } else {
                call.reject("The App Store could not be opened.", ERROR_CANNOT_OPEN)
            }
        }
    }
}

// MARK: - Buying

extension AppStore {
    // A second tap while the sheet is opening would start a second purchase.
    // The call is held here rather than in the bridge, so it is answered once
    // even if the bridge is gone.
    @MainActor
    private func startBuy(_ call: CAPPluginCall, id: String, token: UUID) async {
        guard !isBuying else {
            call.reject("A purchase is already open.", ERROR_BUSY)
            return
        }
        isBuying = true
        defer { isBuying = false }
        do {
            call.resolve(try await purchase(id: id, token: token))
        } catch let error as StoreError {
            call.reject(error.message, error.code)
        } catch {
            call.reject(error.localizedDescription, ERROR_STORE, error)
        }
    }

    private func purchase(id: String, token: UUID) async throws -> [String: Any] {
        guard let product = try await Product.products(for: [id]).first else {
            throw StoreError(
                message: "The store has no such item.", code: ERROR_UNKNOWN_ITEM)
        }
        let outcome: Product.PurchaseResult
        do {
            outcome = try await product.purchase(options: [.appAccountToken(token)])
        } catch StoreKitError.userCancelled {
            return ["result": RESULT_CANCELLED]
        }
        switch outcome {
        case .success(let result):
            let transaction = try verifiedTransaction(result)
            await unfinished.keep(transaction)
            var answer = transactionData(result, transaction)
            answer["result"] = RESULT_PURCHASED
            return answer
        case .pending:
            return ["result": RESULT_PENDING]
        case .userCancelled:
            return ["result": RESULT_CANCELLED]
        @unknown default:
            throw StoreError(
                message: "The store gave an unknown answer.", code: ERROR_STORE)
        }
    }
}

// MARK: - Owned items and updates

extension AppStore {
    private func resolveOwnedItems(_ call: CAPPluginCall) async {
        do {
            call.resolve(["items": try await ownedItemData()])
        } catch {
            call.reject(error.localizedDescription, ERROR_STORE, error)
        }
    }

    private func resolveKnownItems(_ call: CAPPluginCall, syncError: Error) async {
        guard let items = try? await ownedItemData(), !items.isEmpty else {
            call.reject(syncError.localizedDescription, ERROR_STORE, syncError)
            return
        }
        call.resolve(["items": items])
    }

    // Both items share one group, so their statuses repeat; originalID keeps
    // one entry per purchase chain.
    private func ownedItemData() async throws -> [[String: Any]] {
        var seen = Set<UInt64>()
        var items: [[String: Any]] = []
        for status in try await groupStatuses() {
            guard case .verified(let transaction) = status.transaction,
                  seen.insert(transaction.originalID).inserted else { continue }
            items.append(transactionData(status.transaction, transaction))
        }
        return items
    }

    private func groupStatuses() async throws -> [GroupStatus] {
        var statuses: [GroupStatus] = []
        for product in try await Product.products(for: PRODUCT_IDS) {
            guard let info = groupInfo(product) else { continue }
            statuses.append(contentsOf: try await info.status)
        }
        return statuses
    }

    private func groupInfo(_ product: Product) -> GroupInfo? {
        let info = product.subscription // word-check: allow
        return info?.subscriptionGroupID == GROUP_ID ? info : nil // word-check: allow
    }

    // Also carries unfinished transactions StoreKit hands back once at launch.
    private func listenForTransactions() -> Task<Void, Never> {
        return Task.detached { [weak self] in
            for await result in Transaction.updates {
                await self?.deliver(result)
            }
        }
    }

    private func deliver(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else { return }
        await unfinished.keep(transaction)
        let data = transactionData(result, transaction)
        // addListener runs on the bridge's serial queue and the listener tables
        // have no lock, so the event goes through that same queue. Retained until
        // the page listens, since launch deliveries can come first.
        let queue = (bridge as? CapacitorBridge)?.dispatchQueue ?? DispatchQueue.main
        queue.async {
            self.notifyListeners(
                TRANSACTION_EVENT, data: data, retainUntilConsumed: true)
        }
    }

    private func unfinishedTransaction(_ id: UInt64) async -> Transaction? {
        if let kept = await unfinished.take(id) { return kept }
        for await result in Transaction.unfinished {
            if case .verified(let transaction) = result, transaction.id == id {
                return transaction
            }
        }
        return nil
    }
}

// MARK: - Shapes sent to the page

extension AppStore {
    private func itemData(_ product: Product) -> [String: Any] {
        let period = product.subscription?.subscriptionPeriod // word-check: allow
        return [
            "id": product.id,
            "title": product.displayName,
            "displayPrice": product.displayPrice, // word-check: allow
            "periodUnit": period.map { periodUnitName($0.unit) } ?? NSNull(),
            "periodValue": period?.value ?? 0,
        ]
    }

    private func periodUnitName(_ unit: PeriodUnit) -> String {
        switch unit {
        case .day: return "day"
        case .week: return "week"
        case .month: return "month"
        case .year: return "year"
        @unknown default: return "month"
        }
    }

    private func transactionData(
        _ result: VerificationResult<Transaction>,
        _ transaction: Transaction
    ) -> [String: Any] {
        return [
            "signedTransaction": result.jwsRepresentation,
            "transactionId": String(transaction.id),
        ]
    }

    private func verifiedTransaction(
        _ result: VerificationResult<Transaction>
    ) throws -> Transaction {
        guard case .verified(let transaction) = result else {
            throw StoreError(
                message: "Apple could not verify the purchase.", code: ERROR_UNVERIFIED)
        }
        return transaction
    }

    @MainActor
    private func activeWindowScene() -> UIWindowScene? {
        if let scene = bridge?.viewController?.view.window?.windowScene { return scene }
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
    }
}

// Verified transactions the page has not finished yet, by id, so `finish`
// does not have to walk Transaction.unfinished each time.
private actor UnfinishedTransactions {
    private var byId: [UInt64: Transaction] = [:]

    func keep(_ transaction: Transaction) {
        byId[transaction.id] = transaction
    }

    func take(_ id: UInt64) -> Transaction? {
        return byId.removeValue(forKey: id)
    }
}
