const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Hàm Cloud Function để Manager giả danh người dùng khác.
 * Đã được nâng cấp lên v2 để xử lý CORS.
 * Input: { uid: string } - UID của người dùng cần giả danh.
 * Output: { token: string } - Custom Token để đăng nhập.
 */
exports.impersonateUser = onCall({ cors: true }, async (request) => {
  // 1. Kiểm tra xem người gọi đã đăng nhập chưa
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Yêu cầu đăng nhập để thực hiện chức năng này.');
  }

  const callerUid = request.auth.uid;
  const targetUid = request.data.uid;

  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Thiếu UID người dùng mục tiêu.');
  }

  // 2. Kiểm tra quyền Manager trong Firestore (Bảo mật 2 lớp)
  // Mặc dù client có thể check, nhưng server phải check lại để tránh hack.
  const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
  
  if (!callerDoc.exists || callerDoc.data().rule !== 'manager') {
    throw new HttpsError('permission-denied', 'Chỉ tài khoản Manager mới có quyền giả danh.');
  }

  try {
    // 3. Tạo Custom Token bằng Admin SDK, thêm custom claim để biết ai đang giả danh
    const customToken = await admin.auth().createCustomToken(targetUid, {
      impersonatedBy: callerUid,
    });
    logger.log(`Manager ${callerUid} created impersonation token for ${targetUid}`);
    return { token: customToken };
  } catch (error) {
    logger.error("Error creating custom token:", error);
    throw new HttpsError('internal', 'Không thể tạo token giả danh.');
  }
});

/**
 * Hàm Cloud Function để thoát khỏi chế độ giả danh.
 * Hàm này kiểm tra custom claim 'impersonatedBy' trong token của người gọi.
 * Output: { token: string } - Custom Token để đăng nhập lại tài khoản Manager.
 */
exports.revertImpersonation = onCall({ cors: true }, async (request) => {
  // 1. Kiểm tra xem người gọi đã đăng nhập và có claim 'impersonatedBy' chưa
  if (!request.auth || !request.auth.token.impersonatedBy) {
    throw new HttpsError('permission-denied', 'Chỉ tài khoản đang được giả danh mới có thể gọi hàm này.');
  }

  const managerUid = request.auth.token.impersonatedBy;
  const impersonatedUid = request.auth.uid;

  logger.log(`User ${impersonatedUid} is reverting impersonation to manager ${managerUid}`);

  try {
    // 2. Tạo custom token cho Manager UID đã được lưu trong claim
    const managerToken = await admin.auth().createCustomToken(managerUid);
    return { token: managerToken };
  } catch (error) {
    logger.error("Error creating manager token for revert:", error);
    throw new HttpsError('internal', 'Không thể tạo token để quay lại tài khoản Manager.');
  }
});