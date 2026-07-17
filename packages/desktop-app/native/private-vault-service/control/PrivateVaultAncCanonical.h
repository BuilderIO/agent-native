#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultCanonicalStatus) {
  AncPrivateVaultCanonicalStatusOK = 0,
  AncPrivateVaultCanonicalStatusInvalid = 1,
  AncPrivateVaultCanonicalStatusTooLarge = 2,
  AncPrivateVaultCanonicalStatusNonCanonical = 3,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultCanonicalType) {
  AncPrivateVaultCanonicalTypeNull = 0,
  AncPrivateVaultCanonicalTypeBoolean = 1,
  AncPrivateVaultCanonicalTypeInteger = 2,
  AncPrivateVaultCanonicalTypeText = 3,
  AncPrivateVaultCanonicalTypeBytes = 4,
  AncPrivateVaultCanonicalTypeArray = 5,
  AncPrivateVaultCanonicalTypeMap = 6,
};

@interface AncPrivateVaultCanonicalValue : NSObject
@property(nonatomic, readonly) AncPrivateVaultCanonicalType type;
@property(nonatomic, readonly) BOOL booleanValue;
@property(nonatomic, readonly) int64_t integerValue;
@property(nonatomic, readonly, nullable) NSString *textValue;
@property(nonatomic, readonly, nullable) NSData *bytesValue;
@property(nonatomic, readonly, nullable)
    NSArray<AncPrivateVaultCanonicalValue *> *arrayValue;
@property(nonatomic, readonly, nullable)
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *mapValue;

+ (instancetype)nullValue;
+ (instancetype)boolean:(BOOL)value;
+ (nullable instancetype)integer:(int64_t)value;
+ (instancetype)text:(NSString *)value;
+ (instancetype)bytes:(NSData *)value;
+ (instancetype)array:(NSArray<AncPrivateVaultCanonicalValue *> *)value;
+ (nullable instancetype)
    map:(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *)value;
@end

FOUNDATION_EXPORT AncPrivateVaultCanonicalValue *_Nullable
AncPrivateVaultCanonicalDecode(NSData *data, NSUInteger maximumBytes,
                               AncPrivateVaultCanonicalStatus *status);

FOUNDATION_EXPORT NSData *_Nullable
AncPrivateVaultCanonicalEncode(AncPrivateVaultCanonicalValue *value,
                               AncPrivateVaultCanonicalStatus *status);

NS_ASSUME_NONNULL_END
